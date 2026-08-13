"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GREETING,
  KEYTERMS,
  SYSTEM_PROMPT,
  TOOLS,
  TURN_DETECTION,
  VOICE,
} from "./agent";
import { PcmPlayer, base64ToInt16, int16ToBase64, rms } from "./audio";
import { createToolRunner, type ToolEffects } from "./tools";
import { percentile, sessionCost } from "./stats";

const AGENT_WS = "wss://agents.assemblyai.com/v1/ws";
const RATE = 24000;
/** RMS above this counts as speech rather than room noise. */
const VOICED_RMS = 0.015;

export type Status = "idle" | "connecting" | "live" | "ended" | "error";
export type TurnState = "listening" | "thinking" | "speaking" | "interrupted";

export type TimelineItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "agent"; text: string; interrupted: boolean }
  | {
      id: string;
      kind: "tool";
      name: string;
      args: unknown;
      result?: unknown;
      ms?: number;
      cached?: boolean;
    }
  | { id: string; kind: "system"; text: string; tone: "info" | "warn" | "error" };

export type WireEvent = { id: string; dir: "in" | "out"; type: string; at: number };

export type AgentMetrics = {
  /** mic went quiet → transcript finalized */
  sttMs: number | null;
  /** transcript finalized → first byte of Ava's audio */
  replyMs: number | null;
  /** mic went quiet → first byte of Ava's audio; the number a caller feels */
  e2eMs: number | null;
  bestE2eMs: number | null;
  p50E2eMs: number | null;
  p95E2eMs: number | null;
  toolMs: number | null;
  /** click → session.ready, including minting the token */
  connectMs: number | null;
  /** generated audio thrown away by the last barge-in */
  discardedMs: number | null;
  /** times the playback queue ran dry mid-reply, i.e. an audible gap */
  underruns: number;
  turns: number;
  interruptions: number;
  sessionSeconds: number;
  costUsd: number;
};

const EMPTY_METRICS: AgentMetrics = {
  sttMs: null,
  replyMs: null,
  e2eMs: null,
  bestE2eMs: null,
  p50E2eMs: null,
  p95E2eMs: null,
  toolMs: null,
  connectMs: null,
  discardedMs: null,
  underruns: 0,
  turns: 0,
  interruptions: 0,
  sessionSeconds: 0,
  costUsd: 0,
};

let seq = 0;
const uid = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function useVoiceAgent(effects: ToolEffects) {
  const [status, setStatus] = useState<Status>("idle");
  const [turnState, setTurnState] = useState<TurnState>("listening");
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [partial, setPartial] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [wire, setWire] = useState<WireEvent[]>([]);
  const [audioChunks, setAudioChunks] = useState({ sent: 0, received: 0 });
  const [metrics, setMetrics] = useState<AgentMetrics>(EMPTY_METRICS);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const ws = useRef<WebSocket | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const node = useRef<AudioWorkletNode | null>(null);
  const player = useRef<PcmPlayer | null>(null);
  const startedAt = useRef(0);
  const stopping = useRef(false);
  const callTool = useRef(createToolRunner());

  // latency stopwatches
  /**
   * Timestamp of the last mic chunk that actually carried voice, measured
   * locally. Server events (`input.speech.stopped`, `transcript.user`,
   * `reply.started`) all arrive in one burst because the pipeline is overlapped,
   * so they can't anchor a latency measurement — but this can, and it matches
   * what a caller perceives: mouth closes → sound comes out of the speaker.
   */
  const lastVoicedAt = useRef<number | null>(null);
  const speechStoppedAt = useRef<number | null>(null);
  const userFinalAt = useRef<number | null>(null);
  const awaitingFirstAudio = useRef(false);
  /**
   * Ava may still be speaking her previous reply when a new transcript lands, so
   * the next reply.audio chunk can belong to the OLD reply. Only start the clock
   * once a fresh reply.started has come through.
   */
  const replyStarted = useRef(false);
  const e2eSamples = useRef<number[]>([]);
  const connectStartedAt = useRef(0);

  // effects can change identity between renders; keep the latest in a ref so
  // the socket handler never closes over a stale copy
  const fx = useRef(effects);
  useEffect(() => {
    fx.current = effects;
  }, [effects]);

  const push = useCallback((item: TimelineItem) => {
    setTimeline((t) => [...t, item]);
  }, []);

  const logWire = useCallback((dir: "in" | "out", type: string) => {
    setWire((w) => {
      const next = [...w, { id: uid(), dir, type, at: Date.now() }];
      return next.length > 90 ? next.slice(-90) : next;
    });
  }, []);

  const teardown = useCallback(() => {
    node.current?.port.close();
    node.current?.disconnect();
    node.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    player.current?.clear();
    player.current = null;
    ctx.current?.close().catch(() => {});
    ctx.current = null;
    ws.current = null;
    setMicLevel(0);
  }, []);

  const stop = useCallback(() => {
    if (stopping.current) return;
    stopping.current = true;
    const sock = ws.current;

    // Tell the server first: closing the socket without session.end can keep
    // billing the session.
    if (sock?.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ type: "session.end" }));
      logWire("out", "session.end");
      setTimeout(() => {
        if (sock.readyState === WebSocket.OPEN) sock.close();
        teardown();
        stopping.current = false;
        setStatus("ended");
      }, 700);
    } else {
      sock?.close();
      teardown();
      stopping.current = false;
      setStatus("ended");
    }
  }, [logWire, teardown]);

  const beginCapture = useCallback(
    (audioCtx: AudioContext, mic: MediaStream, sock: WebSocket) => {
      const src = audioCtx.createMediaStreamSource(mic);
      const worklet = new AudioWorkletNode(audioCtx, "pcm-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        processorOptions: { targetSampleRate: RATE, chunkSamples: 1200 },
      });
      node.current = worklet;

      worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (sock.readyState !== WebSocket.OPEN) return;
        const samples = new Int16Array(e.data);
        const level = rms(samples);
        setMicLevel(level);
        // local VAD: anchor for the only latency number a caller can feel
        if (level > VOICED_RMS) lastVoicedAt.current = performance.now();
        sock.send(
          JSON.stringify({ type: "input.audio", audio: int16ToBase64(e.data) }),
        );
        setAudioChunks((c) => ({ ...c, sent: c.sent + 1 }));
      };

      src.connect(worklet);
    },
    [],
  );

  const start = useCallback(async () => {
    if (status === "connecting" || status === "live") return;
    setStatus("connecting");
    setError(null);
    setTimeline([]);
    setWire([]);
    setPartial("");
    setAudioChunks({ sent: 0, received: 0 });
    setMetrics(EMPTY_METRICS);
    setTurnState("listening");
    callTool.current = createToolRunner();
    connectStartedAt.current = performance.now();
    e2eSamples.current = [];
    speechStoppedAt.current = null;
    userFinalAt.current = null;
    awaitingFirstAudio.current = false;

    try {
      const res = await fetch("/api/agent-token", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "could not mint a token");
      const token: string = body.token;

      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      stream.current = mic;

      const audioCtx = new AudioContext({ sampleRate: RATE });
      ctx.current = audioCtx;
      await audioCtx.audioWorklet.addModule("/pcm-worklet.js");
      player.current = new PcmPlayer(audioCtx, RATE);

      const url = new URL(AGENT_WS);
      url.searchParams.set("token", token);
      const sock = new WebSocket(url);
      ws.current = sock;

      sock.onopen = () => {
        sock.send(
          JSON.stringify({
            type: "session.update",
            session: {
              system_prompt: SYSTEM_PROMPT,
              greeting: GREETING,
              input: {
                format: { encoding: "audio/pcm" },
                keyterms: KEYTERMS,
                turn_detection: TURN_DETECTION,
              },
              output: {
                voice: VOICE,
                format: { encoding: "audio/pcm" },
                volume: 90,
              },
              tools: TOOLS,
            },
          }),
        );
        logWire("out", "session.update");
      };

      sock.onmessage = (ev) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        const type = String(msg.type);

        // reply.audio dominates the feed; count it instead of logging each one
        if (type !== "reply.audio") logWire("in", type);

        switch (type) {
          case "session.ready": {
            startedAt.current = Date.now();
            const connectMs = Math.round(
              performance.now() - connectStartedAt.current,
            );
            setMetrics((m) => ({ ...m, connectMs }));
            setStatus("live");
            beginCapture(audioCtx, mic, sock);
            push({
              id: uid(),
              kind: "system",
              text: `Session live · ${String(msg.session_id ?? "")}`,
              tone: "info",
            });
            break;
          }

          case "input.speech.started": {
            // barge-in: drop whatever the agent still had queued
            const dropped = player.current?.clear();
            if (dropped && dropped.discardedMs > 0) {
              setMetrics((m) => ({ ...m, discardedMs: dropped.discardedMs }));
            }
            speechStoppedAt.current = null;
            setTurnState("listening");
            break;
          }

          case "input.speech.stopped":
            speechStoppedAt.current = performance.now();
            break;

          case "transcript.user.delta":
            setPartial(String(msg.text ?? ""));
            break;

          case "transcript.user": {
            const now = performance.now();
            userFinalAt.current = now;
            awaitingFirstAudio.current = true;
            replyStarted.current = false;
            const sttMs = lastVoicedAt.current
              ? Math.round(now - lastVoicedAt.current)
              : null;
            setMetrics((m) => ({ ...m, sttMs, turns: m.turns + 1 }));
            setPartial("");
            push({ id: uid(), kind: "user", text: String(msg.text ?? "") });
            setTurnState("thinking");
            break;
          }

          case "reply.started":
            if (awaitingFirstAudio.current) replyStarted.current = true;
            setTurnState("speaking");
            break;

          case "reply.audio": {
            const data = msg.data;
            if (typeof data !== "string") break;

            if (awaitingFirstAudio.current && replyStarted.current) {
              awaitingFirstAudio.current = false;
              replyStarted.current = false;
              const now = performance.now();
              const replyMs = userFinalAt.current
                ? Math.round(now - userFinalAt.current)
                : null;
              const e2eMs = lastVoicedAt.current
                ? Math.round(now - lastVoicedAt.current)
                : null;
              lastVoicedAt.current = null; // consumed — never reuse for a later turn
              speechStoppedAt.current = null;
              if (e2eMs != null) e2eSamples.current.push(e2eMs);
              const all = e2eSamples.current;
              setMetrics((m) => ({
                ...m,
                replyMs,
                e2eMs,
                bestE2eMs: all.length ? Math.min(...all) : m.bestE2eMs,
                p50E2eMs: percentile(all, 50),
                p95E2eMs: percentile(all, 95),
              }));
            }

            const fed = player.current?.push(base64ToInt16(data));
            if (fed?.underrun) {
              setMetrics((m) => ({ ...m, underruns: m.underruns + 1 }));
            }
            setAudioChunks((c) => ({ ...c, received: c.received + 1 }));
            break;
          }

          case "transcript.agent":
            push({
              id: uid(),
              kind: "agent",
              text: String(msg.text ?? ""),
              interrupted: Boolean(msg.interrupted),
            });
            break;

          case "reply.done":
            if (msg.status === "interrupted") {
              setTurnState("interrupted");
              setMetrics((m) => ({ ...m, interruptions: m.interruptions + 1 }));
            } else {
              setTurnState("listening");
            }
            break;

          case "tool.call": {
            const callId = String(msg.call_id);
            const name = String(msg.name);
            const args = (msg.arguments ?? {}) as Record<string, unknown>;
            const t0 = performance.now();

            let result: unknown;
            let cached = false;
            try {
              const out = callTool.current(name, args, fx.current);
              result = out.result;
              cached = out.cached;
            } catch (e) {
              result = { error: e instanceof Error ? e.message : String(e) };
            }
            const ms = Math.round(performance.now() - t0);

            push({ id: callId, kind: "tool", name, args, result, ms, cached });
            setMetrics((m) => ({ ...m, toolMs: ms }));

            sock.send(
              JSON.stringify({
                type: "tool.result",
                call_id: callId,
                result: JSON.stringify(result),
              }),
            );
            logWire("out", "tool.result");
            break;
          }

          case "session.error":
            push({
              id: uid(),
              kind: "system",
              text: `${msg.code}: ${msg.message}`,
              tone: "error",
            });
            break;

          case "session.ended":
            setStatus("ended");
            break;
        }
      };

      sock.onerror = () => {
        setError("WebSocket error — check the console and your API key.");
        setStatus("error");
      };

      sock.onclose = (e) => {
        if (!stopping.current && status !== "ended") {
          if (e.code !== 1000 && e.code !== 1005) {
            setError(`Socket closed (${e.code}) ${e.reason || ""}`.trim());
            setStatus("error");
          } else {
            setStatus("ended");
          }
        }
        teardown();
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      teardown();
    }
  }, [beginCapture, logWire, push, status, teardown]);


  // session clock
  useEffect(() => {
    if (status !== "live") return;
    const t = setInterval(() => {
      const secs = (Date.now() - startedAt.current) / 1000;
      setElapsed(Math.floor(secs));
      setMetrics((m) => ({
        ...m,
        sessionSeconds: secs,
        costUsd: sessionCost(secs),
      }));
    }, 500);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => () => teardown(), [teardown]);

  return {
    status,
    turnState,
    timeline,
    partial,
    micLevel,
    wire,
    audioChunks,
    metrics,
    error,
    elapsed,
    start,
    stop,
  };
}
