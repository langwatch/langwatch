/**
 * The single quality-separation rule used by verdicts and adequacy reporting.
 * Prefer the CI of the score difference from the same bootstrap replicates:
 * shared fit movement cancels, unlike marginal-interval overlap. With no
 * bootstrap difference, overlap is the deliberately conservative fallback.
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
 *
 * A missing or non-finite interval means the bootstrap was disabled or the
 * sample was too small to produce one. That is an absence of evidence, not
 * evidence of a difference, so it counts as "cannot separate" — the
 * conservative direction, and the one that avoids inventing a winner from
 * thin data. NaN in particular has to be caught explicitly: every comparison
 * against it is false, so an unguarded overlap check returns false and its
 * negation reads "distinguishable".
 *
 * ── Why comparability is consulted before any interval ──
 *
 * A pair in different strongly connected components that never met, directly
 * or through a chain, has no gap to measure. The distance between their
 * scores is a gauge artifact of `normalizeToGeometricMean`, and because every
 * bootstrap replicate applies the SAME gauge, the difference interval comes
 * out tight — so the interval test reports high confidence in a number that
 * carries no information. That is the one failure mode here that is confident
 * and wrong rather than merely conservative, so it is checked first.
 *
 * `dominated` pairs deliberately fall through to the interval test: there the
 * direction is established even though the magnitude is unbounded, so the run
 * really has separated them.
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
