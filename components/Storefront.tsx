"use client";

import { CarArt } from "./CarArt";
import { MetricsBar } from "./MetricsBar";
import { CARS, CREDIT_TIERS, findCar, money, type Car } from "@/lib/inventory";
import type { Booking, PaymentQuote } from "@/lib/tools";
import type { AgentMetrics } from "@/lib/useVoiceAgent";
import type { StreamMetrics } from "@/lib/useStreaming";
import type { Mode } from "./VoiceRail";

type Props = {
  selectedId: string;
  compareIds: string[] | null;
  quote: PaymentQuote | null;
  booking: Booking | null;
  onSelect: (id: string) => void;
  cls: (key: string) => string;
  mode: Mode;
  agentMetrics: AgentMetrics;
  streamMetrics: StreamMetrics;
};

export function Storefront({
  selectedId,
  compareIds,
  quote,
  booking,
  onSelect,
  cls,
  mode,
  agentMetrics,
  streamMetrics,
}: Props) {
  const selected = findCar(selectedId) ?? CARS[0];

  return (
    <main className="h-full overflow-y-auto">
      {/* ── masthead ────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-ink/85 px-6 py-3 backdrop-blur-md lg:px-10">
        <div className="flex items-baseline gap-3">
          <span className="display text-lg tracking-tight">CARVOICE</span>
          <span className="eyebrow hidden sm:inline">Used cars, delivered</span>
        </div>
        <span className="data text-[10px] text-dim">
          {CARS.length} in stock · Phoenix · Dallas · Seattle
        </span>
      </header>

      <MetricsBar mode={mode} agent={agentMetrics} stream={streamMetrics} />

      {/* ── thesis ──────────────────────────────────────────────── */}
      <section className="px-6 pt-12 pb-10 lg:px-10 lg:pt-16">
        <p className="eyebrow rise">Built on the AssemblyAI Voice Agent API</p>
        <h1 className="display rise mt-3 text-[clamp(2.5rem,7vw,5.25rem)]">
          Don&apos;t browse.
          <br />
          <span style={{ color: "var(--color-amber)" }}>Just ask.</span>
        </h1>
        <p
          className="rise mt-5 max-w-lg text-base leading-relaxed text-muted"
          style={{ animationDelay: "90ms" }}
        >
          Call Ava and talk the way you would to someone on a lot. She pulls up
          cars, runs your payment, and books the test drive while you talk —
          every change on this page comes from a tool call on the socket.
        </p>
      </section>

      {/* ── inventory ───────────────────────────────────────────── */}
      <section className="px-6 pb-12 lg:px-10">
        <div className="mb-4 flex items-baseline justify-between border-b border-line pb-2">
          <h2 className="eyebrow">Inventory</h2>
          <span className="data text-[10px] text-dim">
            prices include the Carvoice 7-day return
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {CARS.map((car, i) => (
            <button
              key={car.id}
              onClick={() => onSelect(car.id)}
              aria-current={car.id === selectedId}
              className={`rise group rounded-xl border text-left transition-colors ${cls(`card:${car.id}`)} ${
                car.id === selectedId
                  ? "border-amber/60 bg-slab"
                  : "border-line bg-slab hover:border-dim"
              }`}
              style={{ animationDelay: `${140 + i * 70}ms` }}
            >
              <CarArt car={car} className="h-36 w-full rounded-t-xl" />
              <div className="p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="display text-lg leading-tight">
                    {car.make} {car.model}
                  </h3>
                  <span className="data text-sm" style={{ color: "var(--color-amber)" }}>
                    {money(car.price)}
                  </span>
                </div>
                <p className="data mt-1 text-[10px] text-dim">
                  {car.year} · {car.trim} · {car.mileage.toLocaleString()} mi
                </p>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {car.highlights.map((h) => (
                    <li
                      key={h}
                      className="data rounded border border-line px-1.5 py-[3px] text-[9.5px] text-muted"
                    >
                      {h}
                    </li>
                  ))}
                </ul>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ── comparison (only when the agent asked for one) ──────── */}
      {compareIds && compareIds.length >= 2 && (
        <section className="px-6 pb-12 lg:px-10">
          <div
            className={`rounded-xl border border-line bg-slab p-5 ${cls("compare")}`}
          >
            <h2 className="eyebrow mb-4">Side by side</h2>
            <CompareTable ids={compareIds} />
          </div>
        </section>
      )}

      {/* ── selected vehicle ────────────────────────────────────── */}
      <section className="px-6 pb-12 lg:px-10">
        <div className="mb-4 flex items-baseline justify-between border-b border-line pb-2">
          <h2 className="eyebrow">Selected vehicle</h2>
          <span className="data text-[10px] text-dim">VIN {selected.vin}</span>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          <div
            className={`overflow-hidden rounded-xl border border-line bg-slab ${cls(`detail:${selected.id}`)}`}
          >
            <CarArt car={selected} className="h-56 w-full" />
            <div className="p-5">
              <h3 className="display text-3xl">
                {selected.year} {selected.make} {selected.model}
              </h3>
              <p className="data mt-1 text-xs text-muted">{selected.trim}</p>

              <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                <Spec label="Price" value={money(selected.price)} accent />
                <Spec label="MSRP new" value={money(selected.msrp)} />
                <Spec label="Mileage" value={`${selected.mileage.toLocaleString()} mi`} />
                <Spec
                  label={selected.fuel === "Electric" ? "Range" : "Combined"}
                  value={
                    selected.rangeMi
                      ? `${selected.rangeMi} mi`
                      : `${selected.mpg} mpg`
                  }
                />
                <Spec label="0–60" value={`${selected.zeroSixty}s`} />
                <Spec label="Power" value={`${selected.horsepower} hp`} />
                <Spec label="Drivetrain" value={selected.drivetrain} />
                <Spec label="Exterior" value={selected.exterior} />
                <Spec label="Ships from" value={selected.location} />
              </div>

              <ul className="mt-6 grid grid-cols-1 gap-y-1.5 border-t border-line pt-4 sm:grid-cols-2">
                {selected.features.map((f) => (
                  <li key={f} className="flex gap-2 text-[13px] text-muted">
                    <span style={{ color: "var(--color-amber)" }}>·</span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="space-y-4">
            <QuoteCard quote={quote} car={selected} className={cls("quote")} />
            <BookingCard booking={booking} className={cls("booking")} />
          </div>
        </div>
      </section>

      <footer className="border-t border-line px-6 py-6 lg:px-10">
        <p className="data text-[10px] leading-relaxed text-dim">
          Demo build. Inventory, financing, and bookings are fictional. Speech,
          reasoning, and voice run on AssemblyAI.
        </p>
      </footer>
    </main>
  );
}

function Spec({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="eyebrow text-[9.5px]">{label}</p>
      <p
        className="data mt-0.5 text-sm"
        style={accent ? { color: "var(--color-amber)" } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

function CompareTable({ ids }: { ids: string[] }) {
  const cars = ids.map((id) => findCar(id)).filter((c): c is Car => Boolean(c));
  const rows: Array<[string, (c: Car) => string]> = [
    ["Price", (c) => money(c.price)],
    ["Mileage", (c) => `${c.mileage.toLocaleString()} mi`],
    ["Range / mpg", (c) => (c.rangeMi ? `${c.rangeMi} mi` : `${c.mpg} mpg`)],
    ["Power", (c) => `${c.horsepower} hp`],
    ["0–60", (c) => `${c.zeroSixty}s`],
    ["Drivetrain", (c) => c.drivetrain],
    ["In stock", (c) => String(c.stock)],
    ["Delivery", (c) => `${c.transferDays} days`],
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse">
        <thead>
          <tr>
            <th />
            {cars.map((c) => (
              <th key={c.id} className="pb-3 text-left">
                <span className="display text-base">
                  {c.make} {c.model}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, get]) => (
            <tr key={label} className="border-t border-line">
              <td className="eyebrow py-2 pr-4 text-[9.5px] whitespace-nowrap">
                {label}
              </td>
              {cars.map((c) => (
                <td key={c.id} className="data py-2 pr-4 text-[13px] text-paper">
                  {get(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuoteCard({
  quote,
  car,
  className,
}: {
  quote: PaymentQuote | null;
  car: Car;
  className: string;
}) {
  if (!quote) {
    return (
      <div
        className={`rounded-xl border border-dashed border-line bg-slab/40 p-5 ${className}`}
      >
        <h3 className="eyebrow">Monthly payment</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-dim">
          Ask Ava for a payment and the numbers land here. Tell her your down
          payment, term, and credit and she&apos;ll run it.
        </p>
      </div>
    );
  }

  const quoted = findCar(quote.carId) ?? car;

  return (
    <div
      className={`rounded-xl border p-5 ${className}`}
      style={{
        borderColor: "var(--color-amber-dim)",
        background: "color-mix(in oklab, var(--color-amber) 6%, transparent)",
      }}
    >
      <h3 className="eyebrow">Monthly payment</h3>
      <p className="data mt-2 text-[10px] text-muted">
        {quoted.year} {quoted.make} {quoted.model}
      </p>
      <p
        className="data mt-1 text-5xl"
        style={{ color: "var(--color-amber)" }}
      >
        {money(quote.monthly)}
        <span className="text-base text-muted">/mo</span>
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3">
        <Spec label="Down" value={money(quote.down)} />
        <Spec label="Term" value={`${quote.termMonths} mo`} />
        <Spec label="APR" value={`${quote.apr}%`} />
        <Spec label="Credit" value={CREDIT_TIERS[quote.tier].label} />
      </div>
      <p className="data mt-3 text-[10px] text-dim">
        {money(quote.totalInterest)} total interest · estimate only
      </p>
    </div>
  );
}

function BookingCard({
  booking,
  className,
}: {
  booking: Booking | null;
  className: string;
}) {
  if (!booking) {
    return (
      <div
        className={`rounded-xl border border-dashed border-line bg-slab/40 p-5 ${className}`}
      >
        <h3 className="eyebrow">Test drive</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-dim">
          Give Ava a day and a time and your reservation shows up here.
        </p>
      </div>
    );
  }

  const car = findCar(booking.carId);

  return (
    <div
      className={`rounded-xl border p-5 ${className}`}
      style={{
        borderColor: "var(--color-lilac-dim)",
        background: "color-mix(in oklab, var(--color-lilac) 8%, transparent)",
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className="eyebrow">Test drive reserved</h3>
        <span className="data text-[10px]" style={{ color: "var(--color-lilac)" }}>
          {booking.ref}
        </span>
      </div>
      <p className="display mt-2 text-2xl">
        {booking.day} · {booking.time}
      </p>
      <p className="data mt-1 text-[11px] text-muted">
        {car ? `${car.year} ${car.make} ${car.model} — ${car.location}` : ""}
      </p>
      {booking.name && (
        <p className="data mt-3 border-t border-line pt-3 text-[11px] text-muted">
          Held for {booking.name}
        </p>
      )}
    </div>
  );
}
