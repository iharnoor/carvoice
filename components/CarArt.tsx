import type { Car } from "@/lib/inventory";

/**
 * Stand-in for a photography shoot: a paint-matched gradient with a body-style
 * silhouette. Keeps the demo self-contained — no image licensing, no CDN.
 */

const GROUND = 150;

const SEDAN = {
  body: "M34 150 L42 126 Q46 115 60 113 L106 109 Q134 82 186 80 L244 78 Q274 78 290 99 L306 118 L346 124 Q360 127 360 150 Z",
  glass:
    "M118 106 Q142 88 184 86 L236 84 Q258 84 270 100 L280 114 L128 118 Z",
  wheels: [
    [110, 23],
    [296, 23],
  ],
} as const;

const TRUCK = {
  // sharp vertical behind the cab, then a long flat bed rail — the two cues
  // that separate a pickup from a fastback at thumbnail size
  body: "M26 150 L32 122 Q36 111 50 109 L110 105 Q122 74 148 71 L240 66 L247 104 L372 106 L376 150 Z",
  glass: "M154 100 Q160 81 176 79 L233 75 L236 100 Z",
  wheels: [
    [98, 26],
    [318, 26],
  ],
} as const;

export function CarArt({
  car,
  className = "",
}: {
  car: Car;
  className?: string;
}) {
  const [a, b] = car.paint;
  const g = car.body === "truck" ? TRUCK : SEDAN;
  const gid = `paint-${car.id}`;
  const lid = `lamp-${car.id}`;

  return (
    <svg
      viewBox="0 0 400 200"
      className={className}
      role="img"
      aria-label={`${car.exterior} ${car.year} ${car.make} ${car.model}`}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor={a} />
          <stop offset="100%" stopColor={b} />
        </linearGradient>
        <radialGradient id={lid} cx="0.5" cy="0.92" r="0.75">
          <stop offset="0%" stopColor="#ffb01f" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#ffb01f" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="400" height="200" fill={`url(#${gid})`} />
      <rect width="400" height="200" fill={`url(#${lid})`} />

      {/* sodium-lamp streak — the lot-at-night motif */}
      <path d="M0 40 L400 4 L400 19 L0 62 Z" fill="#fff" opacity="0.045" />

      {/* bed rail + wheel-arch line reinforce the pickup read */}
      {car.body === "truck" && (
        <path
          d="M252 118 L368 120"
          stroke="#fff"
          strokeOpacity="0.09"
          strokeWidth="3"
        />
      )}

      <path d={g.body} fill="#05070a" fillOpacity="0.85" />
      <path d={g.glass} fill="#fff" fillOpacity="0.07" />

      {g.wheels.map(([cx, r]) => (
        <g key={cx}>
          <circle cx={cx} cy={GROUND} r={r} fill="#05070a" />
          <circle
            cx={cx}
            cy={GROUND}
            r={r * 0.44}
            fill="none"
            stroke="#39424f"
            strokeWidth="3"
          />
        </g>
      ))}

      {/* headlight glint */}
      <circle cx="40" cy="126" r="3.5" fill="#ffb01f" fillOpacity="0.75" />

      <rect
        y={GROUND + 22}
        width="400"
        height={200 - GROUND - 22}
        fill="#05070a"
        opacity="0.5"
      />
    </svg>
  );
}
