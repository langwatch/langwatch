/**
 * The single quality-separation rule used by verdicts and adequacy reporting. Prefer
 * the CI of the score difference from the same bootstrap replicates: shared fit
 * movement cancels, unlike marginal-interval overlap.
 */

import type {
  BTLeaderboardEntry,
  ScoreDifferenceCI,
} from "./batch-evaluation-results.bt-leaderboard";
import { type Comparability, isIncomparable } from "./batch-evaluation-results.comparability";

/** Two intervals overlap unless one ends strictly before the other starts. */
const intervalsOverlap = (a: [number, number], b: [number, number]): boolean =>
  a[0] <= b[1] && b[0] <= a[1];

const isFinitePair = (interval: [number, number]): boolean =>
  Number.isFinite(interval[0]) && Number.isFinite(interval[1]);

/**
 * Whether the run separates these two variants on quality.
 */
export const areDistinguishable = ({
  a,
  b,
  differenceCI,
  comparability,
}: {
  a: BTLeaderboardEntry;
  b: BTLeaderboardEntry;
  /** Omit or pass null to fall back to comparing the marginal intervals. */
  differenceCI?: ScoreDifferenceCI | null;
  /**
   * Omit for a fit whose graph was never decomposed — no groups means no
   * evidence of a break, so nothing is vetoed.
   */
  comparability?: Comparability | null;
}): boolean => {
  if (isIncomparable({ comparability, a: a.variantId, b: b.variantId })) {
    return false;
  }

  const difference = differenceCI?.[a.variantId]?.[b.variantId];
  if (difference) {
    if (!isFinitePair(difference)) return false;
    // Separated when the whole interval sits on one side of zero.
    return difference[0] > 0 || difference[1] < 0;
  }

  if (!a.scoreCI || !b.scoreCI) return false;
  if (!isFinitePair(a.scoreCI) || !isFinitePair(b.scoreCI)) return false;
  return !intervalsOverlap(a.scoreCI, b.scoreCI);
};
