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

import type { BTLeaderboard } from "./batch-evaluation-results.bt-leaderboard";
import { areDistinguishable } from "./batch-evaluation-results.score-separation";

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
  /**
   * Chance that at least one of the pairs would look separated on luck alone,
   * given each is tested at 95% and several are tested at once. Null when
   * there is at most one pair, where there is no multiplicity to report.
   *
   * Reported rather than corrected for. Widening the intervals until they
   * hold simultaneously was built and measured, and it separated fewer pairs
   * than the plain interval-overlap test this feature started with — every
   * claim would get weaker than before the work, to fix an overstatement a
   * sentence fixes for free. So each pair stays correctly calibrated at 95%
   * on its own, and the reader is told what the count does and does not mean.
   */
  familyWiseFalsePositiveRate: number | null;
};

export const computeSampleAdequacy = (leaderboard: BTLeaderboard): SampleAdequacy => {
  const ranked = leaderboard.entries.filter((entry) => !entry.isDegenerate);
  const rankedVariantCount = ranked.length;
  const totalPairs = (rankedVariantCount * (rankedVariantCount - 1)) / 2;
  const differenceCI = leaderboard.scoreDifferenceCI;

  // The same test the verdict uses, from the same module — including the
  // comparability veto, which has to reach both or the two drift again. A
  // pair from components that never met used to be counted here as separated,
  // so a run split into two islands could report "5 of 6 pairs separated"
  // while every cross-island pair in that count was a gauge artifact.
  let separatedPairs = 0;
  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      if (
        areDistinguishable({
          a: ranked[i]!,
          b: ranked[j]!,
          differenceCI,
          comparability: leaderboard.comparability,
        })
      ) {
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
    // 1 − 0.95^k, the standard independent-tests figure. The pairs are in
    // fact positively correlated, being differences among the same scores,
    // so the true rate is somewhat lower — this errs toward warning, which
    // is the right direction for a caveat.
    familyWiseFalsePositiveRate: totalPairs > 1 ? 1 - Math.pow(0.95, totalPairs) : null,
  };
};
