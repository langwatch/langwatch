/**
 * computeSampleAdequacy — how much of the ranking this run actually
 * established, stated as an observation rather than a forecast.
 *
 * "Did I run enough rows?" is the question every reader has, and the
 * tempting answer is a number: "run 20 more and you'll have a winner."
 * That number is a power calculation over an effect size estimated from
 * the same thin data the reader is already unsure about, so it is a
 * promise the run cannot keep — and being told "20 more" and still ending
 * tied is worse than never being told.
 *
 * What the run CAN say without guessing is how many of the pairs it
 * separated. Four variants have six pairs; separating five of them is a
 * near-complete order, separating none means the run bought nothing. That
 * is a direct, checkable measure of what the sample achieved, and it
 * degrades honestly: more rows raise it, and the reader can watch it rise
 * across runs instead of trusting a projection.
 */

import type { BTLeaderboard, BTLeaderboardEntry } from "./computeBTLeaderboard";

export type SampleAdequacy = {
  /** Head-to-head comparisons the judge resolved. */
  comparisonCount: number;
  /** Variants that could be placed on the scale at all. */
  rankedVariantCount: number;
  /** Pairs among ranked variants whose intervals do not overlap. */
  separatedPairs: number;
  /** Every pair among ranked variants. */
  totalPairs: number;
  /** separatedPairs / totalPairs, or null when there are no pairs. */
  resolution: number | null;
};

const intervalsOverlap = (
  a: [number, number],
  b: [number, number],
): boolean => a[0] <= b[1] && b[0] <= a[1];

/**
 * A missing interval counts as "not separated", matching
 * computeLeaderboardVerdict: absence of evidence is not evidence of a
 * difference, and the conservative direction is the one that avoids
 * reporting resolution the run did not earn.
 */
const isSeparated = (a: BTLeaderboardEntry, b: BTLeaderboardEntry): boolean => {
  if (!a.scoreCI || !b.scoreCI) return false;
  if (
    !Number.isFinite(a.scoreCI[0]) ||
    !Number.isFinite(a.scoreCI[1]) ||
    !Number.isFinite(b.scoreCI[0]) ||
    !Number.isFinite(b.scoreCI[1])
  ) {
    return false;
  }
  return !intervalsOverlap(a.scoreCI, b.scoreCI);
};

export const computeSampleAdequacy = (
  leaderboard: BTLeaderboard,
): SampleAdequacy => {
  const ranked = leaderboard.entries.filter((entry) => !entry.degenerate);
  const rankedVariantCount = ranked.length;
  const totalPairs = (rankedVariantCount * (rankedVariantCount - 1)) / 2;

  let separatedPairs = 0;
  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      if (isSeparated(ranked[i]!, ranked[j]!)) separatedPairs++;
    }
  }

  return {
    comparisonCount: leaderboard.comparisonCount,
    rankedVariantCount,
    separatedPairs,
    totalPairs,
    resolution: totalPairs > 0 ? separatedPairs / totalPairs : null,
  };
};
