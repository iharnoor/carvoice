"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Storefront } from "@/components/Storefront";
import { VoiceRail, type Mode } from "@/components/VoiceRail";
import { useVoiceAgent } from "@/lib/useVoiceAgent";
import { useStreaming } from "@/lib/useStreaming";
import type { Booking, PaymentQuote, ToolEffects } from "@/lib/tools";
import { CARS } from "@/lib/inventory";

export default function Page() {
  const [mode, setMode] = useState<Mode>("agent");
  const [selectedId, setSelectedId] = useState(CARS[0].id);
  const [compareIds, setCompareIds] = useState<string[] | null>(null);
  const [quote, setQuote] = useState<PaymentQuote | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);

  /** Which element a tool just mutated — drives the causality sweep. */
  const [touched, setTouched] = useState<{ key: string; n: number } | null>(null);
  const touch = useCallback((key: string) => {
    setTouched((t) => ({ key, n: (t?.n ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (!touched) return;
    const t = setTimeout(() => setTouched(null), 950);
    return () => clearTimeout(t);
  }, [touched]);

  const cls = useCallback(
    (key: string) => (touched?.key === key ? "is-touched" : ""),
    [touched],
  );

  const scrollTo = useRef<HTMLDivElement>(null);

  const effects = useMemo<ToolEffects>(
    () => ({
      showCar: (carId) => {
        setSelectedId(carId);
        setCompareIds(null);
        touch(`card:${carId}`);
        // let the sweep land on the card, then bring the detail into view
        setTimeout(() => touch(`detail:${carId}`), 420);
      },
      compare: (carIds) => {
        setCompareIds(carIds);
        touch("compare");
      },
      quote: (q) => {
        setSelectedId(q.carId);
        setQuote(q);
        touch("quote");
      },
      book: (b) => {
        setSelectedId(b.carId);
        setBooking(b);
        touch("booking");
      },
    }),
    [touch],
  );

  const agent = useVoiceAgent(effects);
  const stream = useStreaming();

  // Rehearsal aid: `?seed=1` fills the tool-driven cards without a call, so you
  // can frame a screenshot or check layout without talking. The URL is only
  // readable after mount on a statically prerendered page, so this genuinely
  // has to be an effect rather than a state initializer.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("seed") !== "1") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedId("rivian-r1t");
    setCompareIds(["rivian-r1t", "tesla-model-3"]);
    setQuote({
      carId: "rivian-r1t",
      down: 5000,
      termMonths: 60,
      tier: "good",
      apr: 7.99,
      monthly: 1295,
      totalInterest: 13801,
    });
    setBooking({
      carId: "rivian-r1t",
      day: "Saturday",
      time: "2pm",
      name: "Harnoor",
      ref: "CV-23657",
    });
  }, []);

  return (
    // the explicit single column matters: without it the implicit grid column
    // sizes to max-content and the whole layout overflows a phone viewport
    <div className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] overflow-hidden lg:grid-cols-[360px_minmax(0,1fr)] lg:grid-rows-1">
      {/* rail is second on mobile so the storefront leads, first on desktop */}
      <div className="order-2 min-h-0 max-h-[46dvh] lg:order-1 lg:max-h-none">
        <VoiceRail
          mode={mode}
          onModeChange={setMode}
          agent={agent}
          stream={stream}
        />
      </div>
      <div ref={scrollTo} className="order-1 min-h-0 lg:order-2">
        <Storefront
          selectedId={selectedId}
          compareIds={compareIds}
          quote={quote}
          booking={booking}
          onSelect={(id) => {
            setSelectedId(id);
            setCompareIds(null);
          }}
          cls={cls}
          mode={mode}
          agentMetrics={agent.metrics}
          streamMetrics={stream.metrics}
        />
      </div>
    </div>
  );
}
