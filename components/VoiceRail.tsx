"use client";

import { useEffect, useRef } from "react";
import { Meter } from "./Meter";
import type { TimelineItem, TurnState, useVoiceAgent } from "@/lib/useVoiceAgent";
import type { useStreaming } from "@/lib/useStreaming";

export type Mode = "agent" | "stream";

const TURN_COPY: Record<TurnState, { label: string; tone: string }> = {
  listening: { label: "Listening", tone: "var(--color-amber)" },
  thinking: { label: "Thinking", tone: "var(--color-lilac)" },
  speaking: { label: "Ava speaking", tone: "var(--color-amber)" },
  interrupted: { label: "Interrupted", tone: "var(--color-rose)" },
};

function clock(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function VoiceRail({
  mode,
  onModeChange,
  agent,
  stream,
}: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  agent: ReturnType<typeof useVoiceAgent>;
  stream: ReturnType<typeof useStreaming>;
}) {
  const active = mode === "agent" ? agent : stream;
  const isLive = active.status === "live";
  const isConnecting = active.status === "connecting";
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: "smooth",
    });
  }, [agent.timeline.length, agent.partial, stream.turns.length, stream.words]);

  const busy = isLive || isConnecting;

  return (
    <aside className="flex h-full min-h-0 flex-col border-line bg-slab lg:border-r">
      {/* ── header ─────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-line px-5 py-4">
        <div className="flex items-baseline justify-between">
          <h2 className="display text-2xl">Ava</h2>
          <span className="data text-[11px] text-dim">
            {isLive && mode === "agent" ? clock(agent.elapsed) : "—:—"}
          </span>
        </div>
        <p className="eyebrow mt-1">Customer support · Carvoice</p>

        {/* API selector — this is what the audience is here to see */}
        <div
          role="tablist"
          aria-label="AssemblyAI API"
          className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-ink p-1"
        >
          {(
            [
              ["agent", "Voice Agent API"],
              ["stream", "Universal-3.5 Pro"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={mode === key}
              disabled={busy}
              onClick={() => onModeChange(key)}
              className={`data rounded-md px-2 py-2 text-[10.5px] leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                mode === key
                  ? "bg-slab2 text-paper"
                  : "text-dim hover:text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {busy && (
          <p className="data mt-2 text-[10px] text-dim">
            End the session to switch APIs.
          </p>
        )}
      </div>

      {/* ── live state ──────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-line px-5 py-4">
        {mode === "agent" ? (
          <div className="flex items-center justify-between">
            <span
              className="data flex items-center gap-2 text-[11px] uppercase tracking-widest"
              style={{ color: isLive ? TURN_COPY[agent.turnState].tone : "var(--color-dim)" }}
            >
              <span
                className={`inline-block size-[7px] rounded-full ${isLive ? "breathe" : ""}`}
                style={{
                  background: isLive
                    ? TURN_COPY[agent.turnState].tone
                    : "var(--color-dim)",
                }}
              />
              {isLive ? TURN_COPY[agent.turnState].label : active.status}
            </span>
            <span className="data text-[10px] text-dim">
              ↑{agent.audioChunks.sent} ↓{agent.audioChunks.received}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span
              className="data flex items-center gap-2 text-[11px] uppercase tracking-widest"
              style={{ color: isLive ? "var(--color-amber)" : "var(--color-dim)" }}
            >
              <span
                className={`inline-block size-[7px] rounded-full ${isLive ? "breathe" : ""}`}
                style={{
                  background: isLive ? "var(--color-amber)" : "var(--color-dim)",
                }}
              />
              {isLive ? stream.model : active.status}
            </span>
            <span className="data text-[10px] text-dim">
              {(stream.bytesSent / 1024).toFixed(0)} KB sent
            </span>
          </div>
        )}
        <Meter level={active.micLevel} active={isLive} />
      </div>

      {/* ── transcript ──────────────────────────────────────────── */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {active.status === "idle" && (
          <div className="mt-6 space-y-4">
            <p className="text-sm leading-relaxed text-muted">
              {mode === "agent"
                ? "One WebSocket carries your voice up and Ava's voice back. She can see the storefront and change what you're looking at."
                : "Raw transcription only. Watch words arrive as provisional, then lock as the model commits to them."}
            </p>
            <div className="space-y-2">
              <p className="eyebrow">Try saying</p>
              {(mode === "agent"
                ? [
                    "What do you have under twenty-five thousand?",
                    "Show me the Rivian.",
                    "Compare the Tesla and the Rivian.",
                    "What's my payment with five grand down?",
                    "Book me a test drive Saturday at 2.",
                  ]
                : [
                    "I'm looking at the Rivian R1T Quad-Motor.",
                    "What's the APR on a seventy-two month term?",
                  ]
              ).map((s) => (
                <p
                  key={s}
                  className="data rounded-md border border-line bg-ink px-3 py-2 text-[11px] text-muted"
                >
                  {s}
                </p>
              ))}
            </div>
          </div>
        )}

        {active.error && (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-3">
            <p className="eyebrow" style={{ color: "var(--color-rose)" }}>
              Session failed
            </p>
            <p className="data mt-1 text-[11px] leading-relaxed text-paper">
              {active.error}
            </p>
            {active.error.includes("ASSEMBLYAI_API_KEY") && (
              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                Put your key in <span className="data">.env.local</span> as{" "}
                <span className="data">ASSEMBLYAI_API_KEY</span> and restart the
                dev server.
              </p>
            )}
          </div>
        )}

        {mode === "agent" ? (
          <div className="space-y-3">
            {agent.timeline.map((item) => (
              <TimelineRow key={item.id} item={item} />
            ))}
            {agent.partial && (
              <div className="slidein">
                <p className="eyebrow">You</p>
                <p className="text-sm leading-snug text-dim italic">
                  {agent.partial}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {stream.turns.map((t) => (
              <div key={t.order} className="slidein">
                <div className="flex items-center gap-2">
                  <p className="eyebrow">Turn {t.order}</p>
                  <span
                    className="data text-[10px]"
                    style={{ color: "var(--color-lilac)" }}
                  >
                    {t.finalizeMs}ms · {t.partials} updates
                  </span>
                </div>
                <p className="mt-1 text-sm leading-snug text-paper">
                  {t.transcript}
                </p>
              </div>
            ))}
            {stream.words.length > 0 && (
              <div>
                <p className="eyebrow">In flight</p>
                <p className="mt-1 text-sm leading-snug">
                  {stream.words.map((w, i) => (
                    <span
                      key={i}
                      style={{
                        color: w.final
                          ? "var(--color-paper)"
                          : "var(--color-dim)",
                      }}
                      title={`${w.final ? "final" : "provisional"} · ${w.confidence.toFixed(2)}`}
                    >
                      {w.text}{" "}
                    </span>
                  ))}
                </p>
                <p className="data mt-2 text-[10px] text-dim">
                  bright = <span className="text-paper">immutable</span> · dim =
                  still revisable
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── wire feed (agent mode only) ─────────────────────────── */}
      {mode === "agent" && agent.wire.length > 0 && (
        <div className="shrink-0 border-t border-line px-5 py-3">
          <p className="eyebrow mb-2">Socket events</p>
          <div className="flex max-h-16 flex-wrap gap-1 overflow-y-auto">
            {agent.wire.slice(-26).map((e) => (
              <span
                key={e.id}
                className="data rounded border px-1.5 py-[2px] text-[9px]"
                style={{
                  borderColor:
                    e.dir === "out"
                      ? "var(--color-amber-dim)"
                      : "var(--color-lilac-dim)",
                  color:
                    e.dir === "out"
                      ? "var(--color-amber)"
                      : "var(--color-lilac)",
                }}
              >
                {e.dir === "out" ? "↑" : "↓"} {e.type}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── call control ────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-line p-4">
        <button
          onClick={isLive || isConnecting ? active.stop : active.start}
          disabled={isConnecting}
          className={`display w-full rounded-lg py-3.5 text-base transition-all disabled:opacity-60 ${
            isLive || isConnecting
              ? "bg-rose/15 text-rose ring-1 ring-rose/40 hover:bg-rose/25"
              : "bg-amber text-ink hover:brightness-110"
          }`}
        >
          {isConnecting
            ? "Connecting…"
            : isLive
              ? "End call"
              : mode === "agent"
                ? "Call Ava"
                : "Start transcribing"}
        </button>
        <p className="data mt-2 text-center text-[10px] text-dim">
          {mode === "agent"
            ? "agents.assemblyai.com/v1/ws · 24kHz PCM16"
            : "streaming.assemblyai.com/v3/ws · 16kHz PCM16"}
        </p>
      </div>
    </aside>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  if (item.kind === "user") {
    return (
      <div className="slidein">
        <p className="eyebrow">You</p>
        <p className="text-sm leading-snug text-paper">{item.text}</p>
      </div>
    );
  }

  if (item.kind === "agent") {
    return (
      <div className="slidein border-l-2 pl-3" style={{ borderColor: "var(--color-amber)" }}>
        <p className="eyebrow" style={{ color: "var(--color-amber)" }}>
          Ava {item.interrupted && "· cut off"}
        </p>
        <p className="text-sm leading-snug text-paper">{item.text}</p>
      </div>
    );
  }

  if (item.kind === "tool") {
    return (
      <div
        className="slidein rounded-md border px-3 py-2"
        style={{
          borderColor: "var(--color-lilac-dim)",
          background: "color-mix(in oklab, var(--color-lilac) 7%, transparent)",
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="data text-[11px]" style={{ color: "var(--color-lilac)" }}>
            {item.name}()
          </p>
          <span className="data text-[9px] text-dim">
            {item.cached ? "deduped" : `${item.ms}ms`}
          </span>
        </div>
        <pre className="data mt-1 overflow-x-auto text-[10px] leading-relaxed text-muted">
          {JSON.stringify(item.args)}
        </pre>
      </div>
    );
  }

  return (
    <p
      className="data slidein text-[10px]"
      style={{
        color: item.tone === "error" ? "var(--color-rose)" : "var(--color-dim)",
      }}
    >
      {item.text}
    </p>
  );
}
