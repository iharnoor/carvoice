/** Nearest-rank percentile. Returns null for an empty sample. */
export function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

/** Voice Agent API list price, used to show cost accruing during the call. */
export const AGENT_USD_PER_HOUR = 4.5;

export const sessionCost = (seconds: number) =>
  (seconds / 3600) * AGENT_USD_PER_HOUR;
