// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Cheap, one-sided evidence that a day's summary has not folded everything the
 * day's events hold.
 *
 * The fold and the drift check are driven by two independent queues — the
 * projection queue keyed by rollup cell, the process manager's subscriber
 * queue keyed by organization — so nothing orders one against the other. A
 * charge landing shortly before the check's slot can arm and fire the check
 * while its own projection job is still queued. The comparison would then
 * re-derive the day INCLUDING that charge, read a summary written WITHOUT it,
 * and report the difference as drift: a false alarm on a rollup that is
 * perfectly correct and merely seconds behind.
 *
 * `LastEventOccurredAt` is the cheapest signal that this is happening. It is
 * the running maximum of the `occurredAt` of every event the fold applied to
 * that cell (`AbstractFoldProjection.apply`), and the re-fold the comparator
 * runs maintains the very same field on the state it derives — the same
 * quantity from the same code on both sides. A summary strictly behind its
 * events therefore says so in its own numbers.
 *
 * ONE-SIDED, and the asymmetry is the whole point. A maximum cannot count, so
 * a non-empty answer proves the summary is behind while an empty one proves
 * nothing at all:
 *
 *   - two events on the same cell carrying the SAME `occurredAt` (provider
 *     exports commonly bucket timestamps) leave the maximum unmoved, so the
 *     side that folded one of them and the side that folded both read as level;
 *   - an event arriving late but stamped OLDER than the maximum cannot move it
 *     either, and the fold is explicitly order-independent
 *     (`governanceCostRollup.foldProjection.ts`), so this is ordinary, not
 *     pathological.
 *
 * Nothing else in the row does better: `lastObservedAt` and `revisionCount` are
 * a maximum and an admitted under-count. An exact per-cell applied-event count
 * would settle it, but it is a new ClickHouse column that no existing row
 * carries, and every one of them would read as behind forever until a rebuild.
 *
 * So this stays the fast path, and the real judgment is elsewhere: a
 * disagreement is drift only once it has survived the check's retry ladder
 * (`costRollupWatch.process.ts`). What this buys is a named reason on the first
 * retry instead of a shrug.
 *
 * Pure, and deliberately says nothing about what a caller should do with the
 * answer — the waiting belongs at the seam that can retry.
 *
 * @see specs/governance/cost-rollup-watch.feature
 */

/** A cell whose summary has not caught up with the events for its day. */
export interface CostRollupCellBehind {
  /** The fold key, as `encodeGovernanceCostRollupKey` writes it. */
  key: string;
  /** The newest event moment the day's events put in this cell. */
  derivedLastEventOccurredAtMs: number;
  /**
   * The newest event moment the stored summary has folded into it, or null
   * when the summary holds no such cell at all.
   *
   * Null is the strongest form of behind rather than a separate condition: a
   * cell the events describe and the summary has never heard of is a fold that
   * has not run yet — or, once the retries are spent, one that never will.
   */
  summarizedLastEventOccurredAtMs: number | null;
}

/** The slice of either side this comparison reads. Both carry the field. */
interface HasEventWatermark {
  readonly LastEventOccurredAt: number;
}

/**
 * The cells the summary is PROVABLY still catching up on, in the order the
 * re-fold produced them.
 *
 * Empty does not mean caught up — see the asymmetry at the top of this file.
 * It means this signal has nothing to say, which is why no caller may read it
 * as permission to call a disagreement drift.
 *
 * A derived watermark of zero is never reported. It means the day's events for
 * that cell carried no usable moment, so there is no evidence the summary is
 * behind anything — and reading "we cannot tell" as "wait" would park that
 * day's check in the retry ladder until it died, on every run, forever.
 */
export function cellsBehindTheirEvents({
  derived,
  summarized,
}: {
  derived: ReadonlyMap<string, HasEventWatermark>;
  summarized: ReadonlyMap<string, HasEventWatermark>;
}): CostRollupCellBehind[] {
  const behind: CostRollupCellBehind[] = [];
  for (const [key, state] of derived) {
    const derivedLastEventOccurredAtMs = state.LastEventOccurredAt;
    if (derivedLastEventOccurredAtMs <= 0) continue;

    const row = summarized.get(key);
    if (row === undefined) {
      behind.push({
        key,
        derivedLastEventOccurredAtMs,
        summarizedLastEventOccurredAtMs: null,
      });
      continue;
    }
    if (row.LastEventOccurredAt < derivedLastEventOccurredAtMs) {
      behind.push({
        key,
        derivedLastEventOccurredAtMs,
        summarizedLastEventOccurredAtMs: row.LastEventOccurredAt,
      });
    }
  }
  return behind;
}
