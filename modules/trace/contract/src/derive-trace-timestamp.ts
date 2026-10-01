/**
 * Shared timestamp contract: span baseline where available, storage anchor (ADR-087)
 * when trace has no span. See specs/traces/trace-summary-storage-anchor.feature.
 */
export function deriveTraceTimestamp({
  occurredAt,
  storageAnchorMs,
}: {
  /** The span-derived baseline. 0 when the trace carries no span. */
  occurredAt: number;
  /** The storage anchor, when the row's projection version records one. */
  storageAnchorMs?: number | null;
}): number {
  return occurredAt > 0 ? occurredAt : (storageAnchorMs ?? 0);
}
