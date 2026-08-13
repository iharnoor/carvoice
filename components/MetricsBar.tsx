"use client";

import type { AgentMetrics } from "@/lib/useVoiceAgent";
import type { StreamMetrics } from "@/lib/useStreaming";
import type { Mode } from "./VoiceRail";

type Tone = "paper" | "amber" | "lilac" | "good";

const TONES: Record<Tone, string> = {
  paper: "var(--color-paper)",
  amber: "var(--color-amber)",
  lilac: "var(--color-lilac)",
  good: "#4ade80",
};

function Tile({
  label,
  value,
  unit,
  hint,
  tone = "paper",
  big = false,
}: {
  label: string;
  value: string;
  unit?: string;
  hint: string;
  tone?: Tone;
  big?: boolean;
}) {
  return (
    <div
      title={hint}
      className="min-w-0 border-l border-line px-3 py-2 first:border-l-0 first:pl-0"
    >
      <p className="eyebrow text-[8.5px] leading-[1.35] tracking-[0.12em]">
        {label}
      </p>
      <p
        className={`data mt-0.5 leading-none ${big ? "text-2xl sm:text-3xl" : "text-base sm:text-lg"}`}
        style={{ color: value === "—" ? "var(--color-dim)" : TONES[tone] }}
      >
        {value}
        {unit && value !== "—" && (
          <span className="ml-0.5 text-[10px] text-dim">{unit}</span>
        )}
      </p>
    </div>
  );
}

const ms = (v: number | null) => (v == null ? "—" : String(v));
const pct = (v: number | null) =>
  v == null ? "—" : String(Math.round(v <= 1 ? v * 100 : v));

export function MetricsBar({
  mode,
  agent,
  stream,
}: {
  mode: Mode;
  agent: AgentMetrics;
  stream: StreamMetrics;
}) {
  return (
    <div className="border-b border-line bg-slab/50 px-6 py-3 lg:px-10">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="eyebrow">
          {mode === "agent" ? "Live latency" : "Live transcription quality"}
        </p>
        <p className="data truncate text-[9.5px] text-dim">
          {mode === "agent"
            ? "measured in this browser · percentiles over this call"
            : "reported per word by universal-3-5-pro"}
        </p>
      </div>

      {mode === "agent" ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4">
            <Tile
              big
              label="Voice → voice"
              value={ms(agent.e2eMs)}
              unit="ms"
              tone="amber"
              hint="You stopped speaking → first byte of Ava's audio. The only latency number a caller actually feels."
            />
            <Tile
              big
              label="p50"
              value={ms(agent.p50E2eMs)}
              unit="ms"
              tone="amber"
              hint="Median voice-to-voice across every turn in this call."
            />
            <Tile
              big
              label="p95"
              value={ms(agent.p95E2eMs)}
              unit="ms"
              tone="amber"
              hint="95th percentile voice-to-voice. This is the number that decides whether callers think it's slow."
            />
            <Tile
              big
              label="Cost so far"
              value={
                agent.sessionSeconds > 0
                  ? `$${agent.costUsd.toFixed(3)}`
                  : "—"
              }
              hint="Session duration billed at the flat $4.50/hr, which covers speech-to-text, reasoning and voice together."
            />
          </div>

          <div className="mt-3 grid grid-cols-3 border-t border-line pt-2 sm:grid-cols-6">
            <Tile
              label="Endpoint + STT"
              value={ms(agent.sttMs)}
              unit="ms"
              hint="Mic went quiet → final transcript. Includes the silence the server waits out before deciding your turn ended. Most of the latency lives here."
            />
            <Tile
              label="Reason + TTS"
              value={ms(agent.replyMs)}
              unit="ms"
              hint="Final transcript → first audio byte. Near zero, because the server generates the reply while it is still finalizing the transcript."
            />
            <Tile
              label="Connect"
              value={ms(agent.connectMs)}
              unit="ms"
              hint="Button click → session.ready, including minting a temporary token and opening the socket."
            />
            <Tile
              label="Tool"
              value={ms(agent.toolMs)}
              unit="ms"
              tone="lilac"
              hint="Your own function execution time. Spends directly from the latency budget."
            />
            <Tile
              label="Barge-in drop"
              value={ms(agent.discardedMs)}
              unit="ms"
              tone="lilac"
              hint="Generated speech thrown away the last time you interrupted — how far ahead of itself the agent had run."
            />
            <Tile
              label="Gaps / turns / cut"
              value={`${agent.underruns}/${agent.turns}/${agent.interruptions}`}
              tone={agent.underruns === 0 ? "good" : "lilac"}
              hint="Audible playback gaps, conversation turns, and times you talked over Ava. Gaps should stay at zero."
            />
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4">
            <Tile
              big
              label="First partial"
              value={ms(stream.firstPartialMs)}
              unit="ms"
              tone="amber"
              hint="Speech onset → first partial transcript on screen."
            />
            <Tile
              big
              label="p50 finalize"
              value={ms(stream.p50FinalizeMs)}
              unit="ms"
              tone="amber"
              hint="Median time from first partial to a formatted, punctuated final turn."
            />
            <Tile
              big
              label="p95 finalize"
              value={ms(stream.p95FinalizeMs)}
              unit="ms"
              tone="amber"
              hint="95th percentile finalize time across this session."
            />
            <Tile
              big
              label="Committed"
              value={pct(stream.immutablePct)}
              unit="%"
              tone="lilac"
              hint="Share of in-flight words already marked final. Final words never change, so you can act on them immediately."
            />
          </div>

          <div className="mt-3 grid grid-cols-3 border-t border-line pt-2 sm:grid-cols-6">
            <Tile
              label="Word conf"
              value={pct(stream.wordConfidence)}
              unit="%"
              tone="lilac"
              hint="Mean per-word confidence the model reports for words currently in flight."
            />
            <Tile
              label="End-of-turn conf"
              value={pct(stream.eotConfidence)}
              unit="%"
              tone="lilac"
              hint="How sure the model was that your turn had actually ended."
            />
            <Tile
              label="Latest finalize"
              value={ms(stream.finalizeMs)}
              unit="ms"
              hint="Finalize time for the most recent turn."
            />
            <Tile
              label="Words"
              value={String(stream.totalWords || 0)}
              hint="Words in finalized turns this session."
            />
            <Tile
              label="Speech rate"
              value={stream.wordsPerMin == null ? "—" : String(stream.wordsPerMin)}
              unit="wpm"
              hint="Words per minute across the session, including silence."
            />
            <Tile
              label="Uplink"
              value={stream.kbps == null ? "—" : String(stream.kbps)}
              unit="kbps"
              hint="Raw PCM16 upstream bitrate. 16kHz mono is about 256 kbps."
            />
          </div>
        </>
      )}
    </div>
  );
}
