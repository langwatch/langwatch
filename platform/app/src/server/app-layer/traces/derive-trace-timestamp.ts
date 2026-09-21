/**
 * The one timestamp contract every trace reader shares: the span timing
 * baseline where the trace has one, otherwise the ADR-087 storage anchor.
 *
 * A log-only trace has no span start, so its baseline folds to 0 and a reader
 * that took the baseline verbatim filed the row at the epoch and rendered it
 * as "20684d ago". The list rows and the drawer header both call this, so the
 * two cannot drift apart.
 *
 * Spec: specs/traces/trace-summary-storage-anchor.feature
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
