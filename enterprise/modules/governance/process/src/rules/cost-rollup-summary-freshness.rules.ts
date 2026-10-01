// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Port of main's `costRollupSummaryFreshness.ts`: one-sided evidence that a day's summary has not
 * folded every charge the day holds. A non-empty answer proves the fold is behind; an empty one
 * proves nothing, so the retry ladder, not this, judges drift.
 * @see specs/governance/cost-rollup-watch.feature
 */

/** A cell whose summary has not caught up with the events for its day. */
export interface CostRollupCellBehind {
  /** The fold key of the cell. */
  key: string;
  /** The newest event moment the day's events put in this cell. */
  derivedLastEventOccurredAtMs: number;
  /** The newest moment the stored summary folded into it, or null when it holds no such cell. */
  summarizedLastEventOccurredAtMs: number | null;
}

interface HasEventWatermark {
  readonly LastEventOccurredAt: number;
}

/**
 * The cells the summary is provably still catching up on, in the order the re-fold produced them.
 * A derived watermark of zero is never reported: it means "we cannot tell", not "wait".
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
      behind.push({ key, derivedLastEventOccurredAtMs, summarizedLastEventOccurredAtMs: null });
    } else if (row.LastEventOccurredAt < derivedLastEventOccurredAtMs) {
      behind.push({
        key,
        derivedLastEventOccurredAtMs,
        summarizedLastEventOccurredAtMs: row.LastEventOccurredAt,
      });
    }
  }
  return behind;
}
