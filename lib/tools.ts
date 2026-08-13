import {
  CARS,
  CREDIT_TIERS,
  type CreditTier,
  findCar,
  monthlyPayment,
} from "./inventory";

export type PaymentQuote = {
  carId: string;
  down: number;
  termMonths: number;
  tier: CreditTier;
  apr: number;
  monthly: number;
  totalInterest: number;
};

export type Booking = {
  carId: string;
  day: string;
  time: string;
  name?: string;
  ref: string;
};

/** Side effects a tool is allowed to have on the storefront. */
export type ToolEffects = {
  showCar: (carId: string) => void;
  compare: (carIds: string[]) => void;
  quote: (q: PaymentQuote) => void;
  book: (b: Booking) => void;
};

function bookingRef(carId: string, day: string, time: string) {
  // Deterministic so the same request always yields the same reference.
  let h = 0;
  for (const ch of `${carId}|${day}|${time}`) {
    h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return `CV-${(h % 90000 + 10000).toString()}`;
}

/**
 * Models sometimes re-issue an identical tool call in the same breath. Replaying
 * the result is correct, but replaying the *side effect* makes the UI flash
 * twice, so identical calls inside a short window reuse the first result.
 */
export function createToolRunner(windowMs = 15_000) {
  const cache = new Map<string, { at: number; result: unknown }>();

  return function call(
    name: string,
    args: Record<string, unknown>,
    fx: ToolEffects,
  ): { result: unknown; cached: boolean } {
    const key = `${name}(${JSON.stringify(
      Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.localeCompare(b))),
    )})`;
    const hit = cache.get(key);
    const now = Date.now();
    if (hit && now - hit.at < windowMs) {
      return { result: hit.result, cached: true };
    }
    const result = runTool(name, args, fx);
    cache.set(key, { at: now, result });
    return { result, cached: false };
  };
}

/**
 * Runs a tool the agent asked for. Returns the value that gets JSON-stringified
 * back over the socket as `tool.result`.
 */
export function runTool(
  name: string,
  args: Record<string, unknown>,
  fx: ToolEffects,
): unknown {
  switch (name) {
    case "show_car": {
      const car = findCar(String(args.car_id ?? ""));
      if (!car) return { error: "unknown car_id", valid: CARS.map((c) => c.id) };
      fx.showCar(car.id);
      return {
        ok: true,
        showing: `${car.year} ${car.make} ${car.model} ${car.trim}`,
        price: car.price,
        mileage: car.mileage,
        highlights: car.highlights,
      };
    }

    case "compare_cars": {
      const ids = (Array.isArray(args.car_ids) ? args.car_ids : [])
        .map((v) => findCar(String(v))?.id)
        .filter((v): v is string => Boolean(v));
      if (ids.length < 2) return { error: "need at least two valid car_ids" };
      fx.compare(ids);
      return { ok: true, comparing: ids };
    }

    case "estimate_payment": {
      const car = findCar(String(args.car_id ?? ""));
      if (!car) return { error: "unknown car_id" };
      const tier = (
        String(args.credit_tier ?? "good") in CREDIT_TIERS
          ? args.credit_tier
          : "good"
      ) as CreditTier;
      const down = Math.max(0, Number(args.down_payment) || 0);
      const termMonths = Number(args.term_months) || 60;
      const apr = CREDIT_TIERS[tier].apr;
      const calc = monthlyPayment({ price: car.price, down, termMonths, apr });

      const quote: PaymentQuote = {
        carId: car.id,
        down,
        termMonths,
        tier,
        apr,
        monthly: calc.monthly,
        totalInterest: calc.totalInterest,
      };
      fx.quote(quote);

      return {
        ok: true,
        monthly_payment_usd: calc.monthly,
        apr_percent: apr,
        term_months: termMonths,
        down_payment_usd: down,
        amount_financed_usd: calc.principal,
        total_interest_usd: calc.totalInterest,
      };
    }

    case "check_availability": {
      const car = findCar(String(args.car_id ?? ""));
      if (!car) return { error: "unknown car_id" };
      const zip = String(args.zip ?? "").replace(/\D/g, "").slice(0, 5);
      return {
        ok: true,
        in_stock: car.stock,
        stock_status:
          car.stock === 1 ? "last one" : car.stock <= 3 ? "limited" : "good",
        ships_from: car.location,
        delivery_days: car.transferDays + (zip ? 0 : 1),
        delivery_zip: zip || "unknown",
        delivery_fee_usd: car.transferDays > 2 ? 349 : 0,
      };
    }

    case "book_test_drive": {
      const car = findCar(String(args.car_id ?? ""));
      if (!car) return { error: "unknown car_id" };
      const day = String(args.day ?? "").trim();
      const time = String(args.time ?? "").trim();
      if (!day || !time) return { error: "day and time are both required" };

      const booking: Booking = {
        carId: car.id,
        day,
        time,
        name: args.name ? String(args.name) : undefined,
        ref: bookingRef(car.id, day, time),
      };
      fx.book(booking);

      return {
        ok: true,
        confirmation: booking.ref,
        car: `${car.year} ${car.make} ${car.model}`,
        day,
        time,
        location: car.location,
        note: "Bring a valid license. Hold lasts 24 hours.",
      };
    }

    default:
      return { error: `no such tool: ${name}` };
  }
}
