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

import type { BTLeaderboard } from "./computeBTLeaderboard";
import { areDistinguishable } from "./scoreSeparation";

export type SampleAdequacy = {
  /** Head-to-head comparisons the judge resolved. */
  comparisonCount: number;
  /** Variants that could be placed on the scale at all. */
  rankedVariantCount: number;
  /** Pairs among ranked variants the run separated on quality. */
  separatedPairs: number;
  /** Every pair among ranked variants. */
  totalPairs: number;
  /** separatedPairs / totalPairs, or null when there are no pairs. */
  resolution: number | null;
};

export const computeSampleAdequacy = (
  leaderboard: BTLeaderboard,
): SampleAdequacy => {
  const ranked = leaderboard.entries.filter((entry) => !entry.degenerate);
  const rankedVariantCount = ranked.length;
  const totalPairs = (rankedVariantCount * (rankedVariantCount - 1)) / 2;
  const differenceCI = leaderboard.scoreDifferenceCI;

  // The same test the verdict uses, from the same module. These two counted
  // separation independently once and disagreed on screen: the verdict named
  // a clear winner while this panel reported zero separated pairs.
  let separatedPairs = 0;
  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      if (areDistinguishable({ a: ranked[i]!, b: ranked[j]!, differenceCI })) {
        separatedPairs++;
      }
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
