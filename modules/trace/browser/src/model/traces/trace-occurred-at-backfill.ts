import type { TraceHeader } from "@langwatch/trace-contract";

/**
 * The partition hint a header read can supply when the drawer opened without one: the
 * fetched header's own timestamp. A placeholder (the list row) is never the source.
 */
export function deriveOccurredAtBackfill({
  occurredAtMs,
  header,
  traceId,
  isPlaceholderData,
}: {
  occurredAtMs: number | null;
  header: Pick<TraceHeader, "traceId" | "timestamp"> | undefined;
  traceId: string;
  isPlaceholderData: boolean;
}): number | undefined {
  if (occurredAtMs !== null || isPlaceholderData) return undefined;
  if (header?.traceId !== traceId) return undefined;
  return typeof header.timestamp === "number" ? header.timestamp : undefined;
}
