/**
 * The durable once-per-hour guarantee (ADR-039 Decision 5). Queue dedup only
 * squashes re-enqueues while a job is staged — this cursor is the guarantee:
 * claims are compare-and-swap, so across every worker and every restart,
 * exactly one sweep wins each sealed hour and the rest no-op in O(1).
 */
export interface StorageSweepCursorRepository {
  /** True exactly once per sealed hour across all processes. */
  claimHour(params: { sealedHour: Date }): Promise<{ claimed: boolean }>;
  /**
   * True exactly once per UTC day — the entry-transit measurement is
   * day-grained while the sweep is hourly. Call only after claimHour
   * succeeded (the winner of the hour claims the day). `previousDay` is the
   * day the LAST successful claim covered (null on the very first claim):
   * it tells the measurement exactly which missed slices — and therefore
   * which partitions — a catch-up must cover.
   */
  claimEntryDay(params: {
    day: Date;
  }): Promise<{ claimed: boolean; previousDay: Date | null }>;
}
