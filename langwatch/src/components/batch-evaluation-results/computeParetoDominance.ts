/**
 * Which variants are beaten outright, across quality, cost and speed (#5103).
 *
 * The trade-off chart plots three metrics at once, and reading dominance off
 * a scatter is work a reader should not have to do — it means holding three
 * comparisons in your head per pair, and the quality one is not even a
 * comparison of positions but of overlapping intervals. Whether one variant
 * beats another outright has an exact answer, so it is computed here and
 * stated in words; the chart only has to confirm it.
 *
 * Dominance in the Pareto sense: A beats B outright when A is no worse on
 * every dimension and strictly better on at least one. Variants nothing
 * beats form the front — the genuine choice, where something must be traded
 * for something else.
 *
 * The whole value of this rests on what counts as "better", and both answers
 * are deliberately conservative:
 *
 *   - QUALITY uses the same distinguishability test as the verdict, so a
 *     higher score whose interval overlaps its rival's is a TIE, not a win.
 *     Ranking by point estimate here would resurrect precisely the claim the
 *     rest of this feature exists to suppress, and do it in the one place a
 *     reader is being told to drop a variant.
 *
 *   - COST and SPEED use the interval of the mean PER-ROW difference, paired
 *     within the row because both variants answered the same rows and rows
 *     vary far more than variants do. "Cheaper" means that interval sits
 *     entirely below zero.
 *
 *     A pair with no interval — too few rows answered by both — is a tie
 *     rather than a comparison of averages. The flat 5% threshold that used
 *     to stand in here is gone: it was a guess dressed as a rule, calling a
 *     6% difference over two rows "cheaper" while missing a dead-certain 4%
 *     one over two hundred. Sample size is exactly what it could not see.
 *
 * A dimension is only compared at all when every ranked variant recorded
 * enough of it, so a statement never silently rests on one variant's missing
 * data. Degenerate variants are excluded outright: their score is not a
 * measurement, so they can neither beat nor be beaten on quality.
 */

import type {
  BTLeaderboard,
  BTLeaderboardEntry,
  ScoreDifferenceCI,
} from "./computeBTLeaderboard";
import {
  MIN_PRICED_ROWS,
  type VariantMetrics,
} from "./computeVariantMetrics";
import { areDistinguishable } from "./scoreSeparation";


export type TradeoffDimension = "quality" | "cost" | "speed";

export type DominanceEdge = {
  winnerId: string;
  loserId: string;
  /**
   * Dimensions the winner is strictly better on. The rest of
   * `ParetoDominance.dimensions` are ties — never losses, or this would not
   * be an edge. Reported so the sentence can name what was actually won
   * rather than implying a clean sweep.
   */
  strictlyBetterOn: TradeoffDimension[];
};

export type ParetoDominance = {
  /** Dimensions the run recorded well enough to compare every variant on. */
  dimensions: TradeoffDimension[];
  /** Variant id -> ids that beat it outright, in rank order. */
  dominatedBy: Record<string, string[]>;
  /** Variants nothing beats outright, in rank order. */
  front: string[];
  /** Every outright win, winner-first in rank order. */
  edges: DominanceEdge[];
};

/** -1 when `b` is better, +1 when `a` is better, 0 when the run cannot tell. */
type Comparison = -1 | 0 | 1;


const compareQuality = ({
  a,
  b,
  differenceCI,
}: {
  a: BTLeaderboardEntry;
  b: BTLeaderboardEntry;
  differenceCI: ScoreDifferenceCI | null;
}): Comparison => {
  if (!areDistinguishable({ a, b, differenceCI })) return 0;
  return a.score > b.score ? 1 : -1;
};

/** A metric is usable only when it is finite and averaged over enough rows. */
const usableMean = (
  stats: { avg: number; count: number } | null | undefined,
): number | null =>
  stats && Number.isFinite(stats.avg) && stats.count >= MIN_PRICED_ROWS
    ? stats.avg
    : null;

export const computeParetoDominance = ({
  leaderboard,
  variantMetrics,
}: {
  leaderboard: BTLeaderboard;
  variantMetrics: Record<string, VariantMetrics>;
}): ParetoDominance => {
  const ranked = leaderboard.entries.filter((entry) => !entry.isDegenerate);

  const costOf = (variantId: string) =>
    usableMean(variantMetrics[variantId]?.costStats);
  const speedOf = (variantId: string) =>
    usableMean(variantMetrics[variantId]?.durationStats);

  // Every ranked variant must have the metric, or the dimension is dropped.
  // Comparing a pair that happens to have cost while another pair does not
  // would make dominance depend on which rows happened to record a price.
  const dimensions: TradeoffDimension[] = ["quality"];
  if (ranked.length > 0 && ranked.every((e) => costOf(e.variantId) !== null)) {
    dimensions.push("cost");
  }
  if (ranked.length > 0 && ranked.every((e) => speedOf(e.variantId) !== null)) {
    dimensions.push("speed");
  }

  const compare = (
    dimension: TradeoffDimension,
    a: BTLeaderboardEntry,
    b: BTLeaderboardEntry,
  ): Comparison => {
    if (dimension === "quality") {
      return compareQuality({ a, b, differenceCI: leaderboard.scoreDifferenceCI });
    }

    // The paired per-row difference, when the run produced one. This is the
    // real test, and it supersedes the relative floor below — that floor was
    // a stand-in from when no interval existed, and it could call a 6% gap
    // "cheaper" on two rows or miss a dead-certain 4% gap on two hundred.
    const metrics = variantMetrics[a.variantId];
    const differences =
      dimension === "cost"
        ? metrics?.costDifferenceCI
        : metrics?.durationDifferenceCI;
    const paired = differences?.[b.variantId];
    if (paired && paired.every((bound) => Number.isFinite(bound))) {
      // Lower is better, so a is better when the whole interval is below zero.
      if (paired[1] < 0) return 1;
      if (paired[0] > 0) return -1;
      return 0;
    }

    // No interval for this pair means the paired test RAN AND DECLINED — the
    // two shared too few rows to compare — so the run cannot tell them apart
    // on this dimension.
    //
    // There used to be a fallback here that compared the two overall averages
    // against a flat 5% threshold. It judged anyway, by a cruder test, in
    // exactly the case where the averages are least trustworthy, and it was
    // also dead: `VariantMetrics` declares the difference maps non-optional
    // and `computeVariantMetrics` is the only thing that builds one, so no
    // production caller could ever reach it. Ten tests in this module's suite
    // were passing against it.
    return 0;
  };

  const edges: DominanceEdge[] = [];
  const dominatedBy: Record<string, string[]> = Object.fromEntries(
    ranked.map((entry) => [entry.variantId, [] as string[]]),
  );

  for (const winner of ranked) {
    for (const loser of ranked) {
      if (winner.variantId === loser.variantId) continue;

      const results = dimensions.map((d) => compare(d, winner, loser));
      const noneWorse = results.every((r) => r >= 0);
      const someBetter = results.some((r) => r > 0);
      if (!noneWorse || !someBetter) continue;

      edges.push({
        winnerId: winner.variantId,
        loserId: loser.variantId,
        strictlyBetterOn: dimensions.filter((_, i) => results[i]! > 0),
      });
      dominatedBy[loser.variantId]!.push(winner.variantId);
    }
  }

  return {
    dimensions,
    dominatedBy,
    edges,
    front: ranked
      .map((entry) => entry.variantId)
      .filter((variantId) => dominatedBy[variantId]!.length === 0),
  };
};
