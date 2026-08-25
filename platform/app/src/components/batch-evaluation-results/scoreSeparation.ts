/**
 * Does this run separate two variants on quality? (#5103)
 *
 * Every claim the leaderboard makes reduces to this question — who won, who
 * is tied with them, what can be dropped, how much of the order got settled.
 * It lived in two places once, and the two drifted: the verdict called a pair
 * distinguishable while the adequacy panel counted the same pair as unsettled,
 * and both were on screen at the same time. One implementation now.
 *
 * ── Why the difference, and not the two intervals ──
 *
 * The obvious test is "do their confidence intervals overlap?", and it is
 * wrong in a specific, measurable direction.
 *
 * Each bootstrap replicate resamples the comparisons and re-fits the WHOLE
 * field at once, so the scores in a replicate are not independent draws: a
 * resample that happens to be kind to the field lifts everyone together. The
 * marginal interval for a variant therefore includes all of that shared
 * wobble. Subtracting two scores from the SAME replicate cancels it, which is
 * why the difference is usually much tighter than either interval suggests.
 *
 * Asking whether two marginal intervals overlap is a strictly stronger
 * condition than asking whether the difference excludes zero. It errs safe —
 * it can only under-report — but under-reporting is still being wrong, and it
 * is wrong in the shape that reads as "this run cannot tell you" when the run
 * demonstrably could. That is a worse failure for this feature than it sounds:
 * the whole point is to say what the evidence supports, in both directions.
 *
 * The overlap test remains as the fallback for when there are no replicates
 * to difference — with the bootstrap disabled there is nothing better, and
 * being conservative is the right way to be wrong.
 */

import type { BTLeaderboardEntry, ScoreDifferenceCI } from "./computeBTLeaderboard";
import { type Comparability, isIncomparable } from "./computeComparability";

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
