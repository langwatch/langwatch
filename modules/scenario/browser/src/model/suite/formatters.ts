export function formatLatency(milliseconds: number | null): string {
  if (milliseconds == null) return "-";
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)}s`;
  return `${(milliseconds / 60_000).toFixed(1)}m`;
}

/** Three decimals, a fourth only when it is not zero: "$0.024", "$0.0042". */
export function formatCost(cost: number | null): string {
  if (cost == null) return "-";
  const fixed = cost.toFixed(4);
  return `$${fixed.endsWith("0") ? fixed.slice(0, -1) : fixed}`;
}
