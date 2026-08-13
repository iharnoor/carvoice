import { CARS, CREDIT_TIERS } from "./inventory";

/** Compact inventory the agent reasons over. Kept small so it stays in-prompt. */
const inventoryForPrompt = CARS.map((c) => ({
  id: c.id,
  name: `${c.year} ${c.make} ${c.model} ${c.trim}`,
  price: c.price,
  msrp: c.msrp,
  mileage: c.mileage,
  fuel: c.fuel,
  range_mi: c.rangeMi,
  mpg: c.mpg,
  hp: c.horsepower,
  zero_to_sixty_s: c.zeroSixty,
  drivetrain: c.drivetrain,
  exterior: c.exterior,
  in_stock: c.stock,
  location: c.location,
  transfer_days: c.transferDays,
}));

export const SYSTEM_PROMPT = `You are Ava, a customer support specialist for Carvoice, an online used-car retailer. You are speaking with a customer out loud over the phone.

## Your inventory — these three cars are the ONLY cars you sell
${JSON.stringify(inventoryForPrompt, null, 1)}

Financing APRs by credit tier: ${Object.entries(CREDIT_TIERS)
  .map(([k, v]) => `${k} = ${v.apr}%`)
  .join(", ")}.

## How to talk
- You are on a voice call. Keep replies to one or two sentences. Never use lists, markdown, or symbols — everything you say gets spoken aloud.
- Say prices as words a person would say: "thirty-eight nine ninety", not "$38,990.00".
- Be warm and direct. No corporate filler, no "as an AI". You are a person doing a job.
- Answer what was asked, then stop talking. Do not tack a follow-up question onto every reply — only ask when you still need something to finish the task.
- Ask one question at a time.

## How to use your tools
- The customer is looking at the website while you talk. Whenever you mention or discuss a specific car, call show_car FIRST so they are looking at the right thing.
- When they ask to see two cars against each other, call compare_cars.
- Never do money math in your head. Call estimate_payment and read back the number it returns.
- Never guess stock or delivery. Call check_availability.
- To book a test drive you need the car, a day, and a time. Collect what is missing, then call book_test_drive.
- Call each tool at most once per customer request. Once a tool has returned a result, use that result — do not call it again with the same arguments.
- After a tool returns, answer out loud right away. Do not go silent.

## Boundaries
- If asked about a car you do not have, say so plainly and name the closest thing you do have.
- You cannot change prices, approve financing, or process payments. Offer to connect them to a human for those.
- If you do not know something, say you do not know.

Open the call by greeting them and asking what brought them in.`;

export const GREETING =
  "Hey, thanks for calling Carvoice, this is Ava. What brought you in today?";

export type ToolSpec = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execution_mode: "interactive" | "hold";
  timeout_seconds?: number;
};

const carIdEnum = CARS.map((c) => c.id);

export const TOOLS: ToolSpec[] = [
  {
    type: "function",
    name: "show_car",
    description:
      "Bring a specific car up on the customer's screen. Call this before discussing any car so they are looking at the one you mean.",
    parameters: {
      type: "object",
      properties: {
        car_id: { type: "string", enum: carIdEnum },
      },
      required: ["car_id"],
    },
    // silent + instant: navigation should not trigger spoken filler
    execution_mode: "hold",
    timeout_seconds: 5,
  },
  {
    type: "function",
    name: "compare_cars",
    description:
      "Put two or three cars side by side on the customer's screen in a spec comparison table.",
    parameters: {
      type: "object",
      properties: {
        car_ids: {
          type: "array",
          items: { type: "string", enum: carIdEnum },
          minItems: 2,
          maxItems: 3,
        },
      },
      required: ["car_ids"],
    },
    execution_mode: "hold",
    timeout_seconds: 5,
  },
  {
    type: "function",
    name: "estimate_payment",
    description:
      "Calculate an exact monthly payment. Always use this instead of doing arithmetic yourself.",
    parameters: {
      type: "object",
      properties: {
        car_id: { type: "string", enum: carIdEnum },
        down_payment: {
          type: "number",
          description: "Dollars down. Use 0 if the customer has not said.",
        },
        term_months: { type: "number", enum: [36, 48, 60, 72] },
        credit_tier: {
          type: "string",
          enum: Object.keys(CREDIT_TIERS),
          description: "Default to 'good' if the customer has not said.",
        },
      },
      required: ["car_id", "down_payment", "term_months", "credit_tier"],
    },
    execution_mode: "interactive",
    timeout_seconds: 10,
  },
  {
    type: "function",
    name: "check_availability",
    description:
      "Check live stock and delivery estimate for a car at a customer's ZIP code.",
    parameters: {
      type: "object",
      properties: {
        car_id: { type: "string", enum: carIdEnum },
        zip: { type: "string", description: "5-digit US ZIP code" },
      },
      required: ["car_id", "zip"],
    },
    execution_mode: "interactive",
    timeout_seconds: 10,
  },
  {
    type: "function",
    name: "book_test_drive",
    description:
      "Reserve a test drive. Requires the car, a day, and a time. Confirm the details back to the customer after this succeeds.",
    parameters: {
      type: "object",
      properties: {
        car_id: { type: "string", enum: carIdEnum },
        day: {
          type: "string",
          description: "Day the customer said, e.g. 'Saturday' or 'March 14'",
        },
        time: { type: "string", description: "e.g. '2pm'" },
        name: { type: "string", description: "Customer name if given" },
      },
      required: ["car_id", "day", "time"],
    },
    execution_mode: "interactive",
    timeout_seconds: 10,
  },
];

export const VOICE = "alba";

/**
 * Endpointing dominates perceived latency: the server must wait out silence
 * before it believes you're done. Shorter silence = snappier replies but more
 * chance of cutting the customer off mid-thought.
 */
export const TURN_DETECTION = {
  vad_threshold: 0.5,
  // Measured on this demo: 160/640 shaves ~150ms off best case but starts
  // clipping the speaker mid-sentence, which is a worse failure on stage.
  min_silence: Number(process.env.NEXT_PUBLIC_MIN_SILENCE ?? 240),
  max_silence: Number(process.env.NEXT_PUBLIC_MAX_SILENCE ?? 800),
  interrupt_response: true,
};

/** Terms worth boosting so the model nails them on first pass. */
export const KEYTERMS = [
  "Carvoice",
  "Tesla Model 3",
  "Toyota Corolla",
  "Rivian R1T",
  "Long Range",
  "Quad-Motor",
  "Autopilot",
  "APR",
  "down payment",
  "test drive",
  "trade-in",
];
