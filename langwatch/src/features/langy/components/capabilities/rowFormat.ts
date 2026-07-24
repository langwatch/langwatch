/**
 * Row wording shared by the capability cards and the hydrators.
 *
 * A trace row reads the same whether it was parsed out of the stored CLI
 * output or hydrated fresh from the API — "2 Jul 14:03 · 1.2s · $0.0041 ·
 * failed" — so the formatting lives once, here, and both producers import it.
 */

export function truncateRowText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

export function formatRowWhen(startedAt: number): string {
  return new Date(startedAt).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRowLatency(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatRowCost(cost: number): string {
  // Sub-cent costs are the norm for a single trace, so two decimals would round
  // almost every trace to "$0.00" and tell the reader nothing.
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

/** `2 Jul 14:03 · 1.2s · $0.0041 · failed` — only the parts actually known. */
export function traceMetaLine({
  startedAt,
  latencyMs,
  cost,
  isError,
  output,
}: {
  startedAt?: number;
  latencyMs?: number;
  cost?: number;
  isError?: boolean;
  output?: string;
}): string {
  const parts: string[] = [];
  if (startedAt !== undefined) parts.push(formatRowWhen(startedAt));
  if (latencyMs !== undefined) parts.push(formatRowLatency(latencyMs));
  if (cost !== undefined) parts.push(formatRowCost(cost));
  if (isError) parts.push("failed");
  else if (output) parts.push(output);
  return parts.join(" · ");
}
