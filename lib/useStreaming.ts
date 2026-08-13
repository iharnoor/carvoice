"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { rms } from "./audio";
import { KEYTERMS } from "./agent";
import { percentile } from "./stats";

const STREAM_WS = "wss://streaming.assemblyai.com/v3/ws";
const RATE = 16000;

export type StreamWord = { text: string; final: boolean; confidence: number };

export type FinishedTurn = {
  order: number;
  transcript: string;
  /** ms from the first partial of this turn to the finalized, formatted turn */
  finalizeMs: number;
  partials: number;
  confidence: number;
};

export type StreamMetrics = {
  /** ms from speech onset to the first partial transcript landing */
  firstPartialMs: number | null;
  /** ms from first partial to finalized turn, last turn */
  finalizeMs: number | null;
  p50FinalizeMs: number | null;
  p95FinalizeMs: number | null;
  /** words in finalized turns, and the rate they arrived at */
  totalWords: number;
  wordsPerMin: number | null;
  /** mean per-word confidence across the words currently in flight */
  wordConfidence: number | null;
  /** model's confidence that the turn actually ended */
  eotConfidence: number | null;
  /** share of in-flight words the model has already committed to */
  immutablePct: number | null;
  partials: number | null;
  turns: number;
  kbps: number | null;
};

const EMPTY: StreamMetrics = {
  firstPartialMs: null,
  finalizeMs: null,
  p50FinalizeMs: null,
  p95FinalizeMs: null,
  totalWords: 0,
  wordsPerMin: null,
  wordConfidence: null,
  eotConfidence: null,
  immutablePct: null,
  partials: null,
  turns: 0,
  kbps: null,
};

export type StreamStatus = "idle" | "connecting" | "live" | "ended" | "error";

export function useStreaming() {
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [words, setWords] = useState<StreamWord[]>([]);
  const [turns, setTurns] = useState<FinishedTurn[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [metrics, setMetrics] = useState<StreamMetrics>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [bytesSent, setBytesSent] = useState(0);
  const [model, setModel] = useState("universal-3-5-pro");

  const ws = useRef<WebSocket | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const node = useRef<AudioWorkletNode | null>(null);

  const turnOpenedAt = useRef(new Map<number, number>());
  const partialCount = useRef(new Map<number, number>());
  const speechStartedAt = useRef<number | null>(null);
  const finalizeSamples = useRef<number[]>([]);
  const audioStartedAt = useRef(0);
  const bytes = useRef(0);

  const teardown = useCallback(() => {
    node.current?.port.close();
    node.current?.disconnect();
    node.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    ctx.current?.close().catch(() => {});
    ctx.current = null;
    ws.current = null;
    setMicLevel(0);
  }, []);

  const stop = useCallback(() => {
    const sock = ws.current;
    if (sock?.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ type: "Terminate" }));
      setTimeout(() => sock.close(), 400);
    }
    teardown();
    setStatus("ended");
  }, [teardown]);

  const start = useCallback(async () => {
    if (status === "connecting" || status === "live") return;
    setStatus("connecting");
    setError(null);
    setWords([]);
    setTurns([]);
    setBytesSent(0);
    setMetrics(EMPTY);
    turnOpenedAt.current.clear();
    partialCount.current.clear();
    finalizeSamples.current = [];
    speechStartedAt.current = null;
    bytes.current = 0;

    try {
      const res = await fetch("/api/stream-token", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "could not mint a token");

      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      stream.current = mic;

      const audioCtx = new AudioContext({ sampleRate: RATE });
      ctx.current = audioCtx;
      await audioCtx.audioWorklet.addModule("/pcm-worklet.js");

      const url = new URL(STREAM_WS);
      url.searchParams.set("token", body.token);
      url.searchParams.set("speech_model", "universal-3-5-pro");
      url.searchParams.set("sample_rate", String(RATE));
      url.searchParams.set("encoding", "pcm_s16le");
      url.searchParams.set("format_turns", "true");
      url.searchParams.set("mode", "balanced");
      url.searchParams.set("keyterms_prompt", JSON.stringify(KEYTERMS));

      const sock = new WebSocket(url);
      // this endpoint takes raw binary audio frames, not base64 JSON
      sock.binaryType = "arraybuffer";
      ws.current = sock;

      sock.onmessage = (ev) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }

        switch (msg.type) {
          case "Begin": {
            setStatus("live");
            if (typeof msg.speech_model === "string") setModel(msg.speech_model);
            audioStartedAt.current = performance.now();

            const src = audioCtx.createMediaStreamSource(mic);
            const worklet = new AudioWorkletNode(audioCtx, "pcm-processor", {
              numberOfInputs: 1,
              numberOfOutputs: 0,
              processorOptions: {
                targetSampleRate: RATE,
                chunkSamples: 800, // 50ms @ 16kHz
              },
            });
            node.current = worklet;
            worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
              if (sock.readyState !== WebSocket.OPEN) return;
              setMicLevel(rms(new Int16Array(e.data)));
              sock.send(e.data);
              bytes.current += e.data.byteLength;
              setBytesSent(bytes.current);
              const secs = (performance.now() - audioStartedAt.current) / 1000;
              if (secs > 0.5) {
                setMetrics((m) => ({
                  ...m,
                  kbps: Math.round((bytes.current / 1024 / secs) * 8),
                }));
              }
            };
            src.connect(worklet);
            break;
          }

          case "SpeechStarted":
            speechStartedAt.current = performance.now();
            break;

          case "Turn": {
            const order = Number(msg.turn_order ?? 0);
            const now = performance.now();

            const isFirstPartial = !turnOpenedAt.current.has(order);
            if (isFirstPartial) {
              turnOpenedAt.current.set(order, now);
              if (speechStartedAt.current) {
                const fp = Math.round(now - speechStartedAt.current);
                setMetrics((m) => ({ ...m, firstPartialMs: fp }));
              }
            }
            partialCount.current.set(
              order,
              (partialCount.current.get(order) ?? 0) + 1,
            );

            const raw = (msg.words ?? []) as Array<{
              text: string;
              word_is_final?: boolean;
              confidence?: number;
            }>;
            const mapped = raw.map((w) => ({
              text: w.text,
              final: Boolean(w.word_is_final),
              confidence: w.confidence ?? 0,
            }));
            setWords(mapped);

            if (mapped.length) {
              const conf =
                mapped.reduce((a, w) => a + w.confidence, 0) / mapped.length;
              const immutable =
                (mapped.filter((w) => w.final).length / mapped.length) * 100;
              setMetrics((m) => ({
                ...m,
                wordConfidence: conf,
                immutablePct: Math.round(immutable),
                partials: partialCount.current.get(order) ?? 1,
              }));
            }

            if (msg.end_of_turn && msg.turn_is_formatted) {
              const openedAt = turnOpenedAt.current.get(order) ?? now;
              const transcript = String(msg.transcript ?? "");
              const finalizeMs = Math.round(now - openedAt);

              if (transcript.trim()) {
                finalizeSamples.current.push(finalizeMs);
                const all = finalizeSamples.current;
                setTurns((t) => [
                  ...t,
                  {
                    order,
                    transcript,
                    finalizeMs,
                    partials: partialCount.current.get(order) ?? 1,
                    confidence: Number(msg.end_of_turn_confidence ?? 0),
                  },
                ]);
                const spokenMin =
                  (performance.now() - audioStartedAt.current) / 60000;
                setMetrics((m) => {
                  const totalWords =
                    m.totalWords + transcript.trim().split(/\s+/).length;
                  return {
                    ...m,
                    finalizeMs,
                    p50FinalizeMs: percentile(all, 50),
                    p95FinalizeMs: percentile(all, 95),
                    totalWords,
                    wordsPerMin:
                      spokenMin > 0.05 ? Math.round(totalWords / spokenMin) : null,
                    eotConfidence: Number(msg.end_of_turn_confidence ?? 0),
                    turns: m.turns + 1,
                  };
                });
              }
              setWords([]);
              speechStartedAt.current = null;
            }
            break;
          }

          case "Termination":
            setStatus("ended");
            break;
        }
      };

      sock.onerror = () => {
        setError("WebSocket error — check the console and your API key.");
        setStatus("error");
      };

      sock.onclose = (e) => {
        if (e.code !== 1000 && e.code !== 1005 && status !== "ended") {
          setError(`Socket closed (${e.code}) ${e.reason || ""}`.trim());
          setStatus("error");
        }
        teardown();
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      teardown();
    }
  }, [status, teardown]);

  useEffect(() => () => teardown(), [teardown]);

  return {
    status,
    words,
    turns,
    micLevel,
    metrics,
    error,
    bytesSent,
    model,
    start,
    stop,
  };
}
