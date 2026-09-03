export function formatLatency(milliseconds: number | null): string {
  if (milliseconds == null) return "-";
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)}s`;
  return `${(milliseconds / 60_000).toFixed(1)}m`;
}

export function formatCost(cost: number | null): string {
  if (cost == null) return "-";
  return `$${cost.toFixed(4)}`;
}
