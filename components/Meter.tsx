"use client";

import { useEffect, useRef, useState } from "react";

const BARS = 44;
const ZEROS: number[] = Array(BARS).fill(0);

/** Rolling mic-level histogram. Real RMS, not a decorative loop. */
export function Meter({
  level,
  active,
  color = "var(--color-amber)",
}: {
  level: number;
  active: boolean;
  color?: string;
}) {
  const [history, setHistory] = useState<number[]>(ZEROS);
  const latest = useRef(level);

  useEffect(() => {
    latest.current = level;
  }, [level]);

  useEffect(() => {
    if (!active) return;
    // buffer lives in the closure, so each session starts from silence
    let buf = ZEROS;
    const t = setInterval(() => {
      buf = [...buf.slice(1), latest.current];
      setHistory(buf);
    }, 55);
    return () => clearInterval(t);
  }, [active]);

  const bars = active ? history : ZEROS;

  return (
    <div className="flex h-10 items-center gap-[2px]" aria-hidden>
      {bars.map((v, i) => {
        // sqrt curve so quiet speech is still visible
        const h = Math.max(2, Math.min(1, Math.sqrt(v) * 2.6) * 40);
        return (
          <span
            key={i}
            className="w-[3px] shrink-0 rounded-full transition-[height] duration-75"
            style={{
              height: `${h}px`,
              background: color,
              opacity: 0.25 + (i / BARS) * 0.75,
            }}
          />
        );
      })}
    </div>
  );
}
