export type Body = "sedan" | "truck";

export type Car = {
  id: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  body: Body;
  price: number;
  msrp: number;
  mileage: number;
  /** EPA range in miles for EVs, undefined for gas */
  rangeMi?: number;
  /** combined mpg for gas cars */
  mpg?: number;
  fuel: "Electric" | "Gasoline";
  horsepower: number;
  zeroSixty: number;
  seats: number;
  drivetrain: string;
  exterior: string;
  interior: string;
  vin: string;
  stock: number;
  location: string;
  transferDays: number;
  highlights: string[];
  features: string[];
  /** hex pair used for the card artwork */
  paint: [string, string];
};

export const CARS: Car[] = [
  {
    id: "tesla-model-3",
    year: 2024,
    make: "Tesla",
    model: "Model 3",
    trim: "Long Range AWD",
    body: "sedan",
    price: 38_990,
    msrp: 47_490,
    mileage: 12_480,
    rangeMi: 341,
    fuel: "Electric",
    horsepower: 394,
    zeroSixty: 4.2,
    seats: 5,
    drivetrain: "Dual Motor AWD",
    exterior: "Deep Blue Metallic",
    interior: "Black Premium",
    vin: "5YJ3E1EB7NF••••••",
    stock: 3,
    location: "Phoenix, AZ",
    transferDays: 2,
    highlights: ["341 mi range", "4.2s 0–60", "Autopilot included"],
    features: [
      "Enhanced Autopilot",
      "15-inch center touchscreen",
      "Glass panoramic roof",
      "Heated front & rear seats",
      "Supercharger network access",
      "Over-the-air updates",
    ],
    paint: ["#1e3a8a", "#0b1220"],
  },
  {
    id: "toyota-corolla",
    year: 2025,
    make: "Toyota",
    model: "Corolla",
    trim: "LE",
    body: "sedan",
    price: 21_450,
    msrp: 23_460,
    mileage: 8_120,
    mpg: 35,
    fuel: "Gasoline",
    horsepower: 169,
    zeroSixty: 8.2,
    seats: 5,
    drivetrain: "FWD",
    exterior: "Celestite Gray",
    interior: "Light Gray Fabric",
    vin: "JTDEPMAE9NJ••••••",
    stock: 7,
    location: "Dallas, TX",
    transferDays: 1,
    highlights: ["35 mpg combined", "Toyota Safety Sense 3.0", "Best value"],
    features: [
      "Toyota Safety Sense 3.0",
      "8-inch touchscreen",
      "Wireless Apple CarPlay",
      "Adaptive cruise control",
      "Lane departure alert",
      "10-year powertrain warranty",
    ],
    paint: ["#475569", "#111827"],
  },
  {
    id: "rivian-r1t",
    year: 2024,
    make: "Rivian",
    model: "R1T",
    trim: "Adventure Quad-Motor",
    body: "truck",
    price: 68_900,
    msrp: 87_400,
    mileage: 15_930,
    rangeMi: 328,
    fuel: "Electric",
    horsepower: 835,
    zeroSixty: 3.0,
    seats: 5,
    drivetrain: "Quad Motor AWD",
    exterior: "Forest Green",
    interior: "Ocean Coast Vegan Leather",
    vin: "7PDSGABA5PN••••••",
    stock: 1,
    location: "Seattle, WA",
    transferDays: 4,
    highlights: ["835 hp", "3.0s 0–60", "11,000 lb towing"],
    features: [
      "Gear Tunnel storage",
      "11,000 lb max towing",
      "Air suspension, 15in travel",
      "Camp Mode & onboard power",
      "Driver+ highway assist",
      "Four-motor torque vectoring",
    ],
    paint: ["#14532d", "#0a0f0d"],
  },
];

export const CAR_IDS = CARS.map((c) => c.id);

export function findCar(idOrName: string): Car | undefined {
  const q = idOrName.toLowerCase().trim();
  return (
    CARS.find((c) => c.id === q) ??
    CARS.find((c) => `${c.make} ${c.model}`.toLowerCase() === q) ??
    CARS.find((c) => c.model.toLowerCase() === q) ??
    CARS.find((c) => c.make.toLowerCase() === q) ??
    CARS.find((c) => q.includes(c.model.toLowerCase())) ??
    CARS.find((c) => q.includes(c.make.toLowerCase()))
  );
}

export const CREDIT_TIERS = {
  excellent: { label: "Excellent (720+)", apr: 5.49 },
  good: { label: "Good (660–719)", apr: 7.99 },
  fair: { label: "Fair (600–659)", apr: 11.99 },
  rebuilding: { label: "Rebuilding (<600)", apr: 16.49 },
} as const;

export type CreditTier = keyof typeof CREDIT_TIERS;

export function monthlyPayment(opts: {
  price: number;
  down: number;
  termMonths: number;
  apr: number;
}) {
  const principal = Math.max(0, opts.price - opts.down);
  const r = opts.apr / 100 / 12;
  const n = opts.termMonths;
  const monthly =
    r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n));
  const total = monthly * n;
  return {
    monthly: Math.round(monthly),
    principal: Math.round(principal),
    totalInterest: Math.round(total - principal),
    totalCost: Math.round(total + opts.down),
  };
}

export const money = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
