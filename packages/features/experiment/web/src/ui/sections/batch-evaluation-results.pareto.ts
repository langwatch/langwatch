/**
 * Pareto dominance across quality, cost and speed. A variant wins only when it is no
 * worse on every usable dimension and better on at least one.
 */

import type {
  BTLeaderboard,
  BTLeaderboardEntry,
  ScoreDifferenceCI,
} from "../../model/batch-evaluation-results.bt-leaderboard";
import type { Comparability } from "../../model/batch-evaluation-results.comparability";
import { MIN_PRICED_ROWS, type VariantMetrics } from "./batch-evaluation-results.variant-metrics";
import { areDistinguishable } from "../../model/batch-evaluation-results.score-separation";

export type TradeoffDimension = "quality" | "cost" | "speed";

export type DominanceEdge = {
  winnerId: string;
  loserId: string;
  /**
   * Dimensions the winner is strictly better on. The rest of
   * `ParetoDominance.dimensions` are ties — never losses, or this would not be an edge.
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
  comparability,
}: {
  a: BTLeaderboardEntry;
  b: BTLeaderboardEntry;
  differenceCI: ScoreDifferenceCI | null;
  comparability: Comparability;
}): Comparison => {
  // Comparability is passed here for the same reason the verdict and the
  // adequacy count take it: this is the third caller of `areDistinguishable`,
  // and it is the one that turns a separation into an instruction. A pair
  // from groups that never met would otherwise be ordered on a gauge
  // artifact and then reported as "beaten outright and can be dropped".
  if (!areDistinguishable({ a, b, differenceCI, comparability })) return 0;
  return a.score > b.score ? 1 : -1;
};

/** A metric is usable only when it is finite and averaged over enough rows. */
const usableMean = (stats: { avg: number; count: number } | null | undefined): number | null =>
  stats && Number.isFinite(stats.avg) && stats.count >= MIN_PRICED_ROWS ? stats.avg : null;

/**
 * Cost and speed: the interval of the mean paired per-row difference.
 */
const comparePairedMetric = ({
  metrics,
  dimension,
  otherVariantId,
}: {
  metrics: VariantMetrics | undefined;
  dimension: "cost" | "speed";
  otherVariantId: string;
}): Comparison => {
  const differences =
    dimension === "cost" ? metrics?.costDifferenceCI : metrics?.durationDifferenceCI;
  const paired = differences?.[otherVariantId];
  if (!paired?.every((bound) => Number.isFinite(bound))) return 0;

  // Lower is better, so a is better when the whole interval is below zero.
  if (paired[1] < 0) return 1;
  if (paired[0] > 0) return -1;
  return 0;
};

const compareOn = ({
  dimension,
  a,
  b,
  leaderboard,
  variantMetrics,
}: {
  dimension: TradeoffDimension;
  a: BTLeaderboardEntry;
  b: BTLeaderboardEntry;
  leaderboard: BTLeaderboard;
  variantMetrics: Record<string, VariantMetrics>;
}): Comparison => {
  if (dimension === "quality") {
    return compareQuality({
      a,
      b,
      differenceCI: leaderboard.scoreDifferenceCI,
      comparability: leaderboard.comparability,
    });
  }
  return comparePairedMetric({
    metrics: variantMetrics[a.variantId],
    dimension,
    otherVariantId: b.variantId,
  });
};

/** Whether every ranked variant recorded enough of this metric to compare. */
const everyVariantRecorded = ({
  ranked,
  variantMetrics,
  dimension,
}: {
  ranked: BTLeaderboardEntry[];
  variantMetrics: Record<string, VariantMetrics>;
  dimension: "cost" | "speed";
}): boolean =>
  ranked.length > 0 &&
  ranked.every((entry) => {
    const metrics = variantMetrics[entry.variantId];
    const stats = dimension === "cost" ? metrics?.costStats : metrics?.durationStats;
    return usableMean(stats) !== null;
  });

/**
 * The dimensions this run may state dominance on.
 */
const comparableDimensions = ({
  ranked,
  variantMetrics,
}: {
  ranked: BTLeaderboardEntry[];
  variantMetrics: Record<string, VariantMetrics>;
}): TradeoffDimension[] => {
  const dimensions: TradeoffDimension[] = ["quality"];
  if (everyVariantRecorded({ ranked, variantMetrics, dimension: "cost" })) {
    dimensions.push("cost");
  }
  if (everyVariantRecorded({ ranked, variantMetrics, dimension: "speed" })) {
    dimensions.push("speed");
  }
  return dimensions;
};

/** The edge for one ordered pair, or null when the winner does not dominate. */
const dominanceEdge = ({
  winner,
  loser,
  dimensions,
  leaderboard,
  variantMetrics,
}: {
  winner: BTLeaderboardEntry;
  loser: BTLeaderboardEntry;
  dimensions: TradeoffDimension[];
  leaderboard: BTLeaderboard;
  variantMetrics: Record<string, VariantMetrics>;
}): DominanceEdge | null => {
  const results = dimensions.map((dimension) =>
    compareOn({ dimension, a: winner, b: loser, leaderboard, variantMetrics }),
  );
  const noneWorse = results.every((r) => r >= 0);
  const someBetter = results.some((r) => r > 0);
  if (!noneWorse || !someBetter) return null;

  return {
    winnerId: winner.variantId,
    loserId: loser.variantId,
    strictlyBetterOn: dimensions.filter((_, i) => results[i]! > 0),
  };
};

export const computeParetoDominance = ({
  leaderboard,
  variantMetrics,
}: {
  leaderboard: BTLeaderboard;
  variantMetrics: Record<string, VariantMetrics>;
}): ParetoDominance => {
  const ranked = leaderboard.entries.filter((entry) => !entry.isDegenerate);
  const dimensions = comparableDimensions({ ranked, variantMetrics });

  const edges: DominanceEdge[] = [];
  const dominatedBy: Record<string, string[]> = {};
  for (const entry of ranked) {
    dominatedBy[entry.variantId] = [];
  }

  for (const winner of ranked) {
    for (const loser of ranked) {
      if (winner.variantId === loser.variantId) continue;

      const edge = dominanceEdge({
        winner,
        loser,
        dimensions,
        leaderboard,
        variantMetrics,
      });
      if (!edge) continue;

      edges.push(edge);
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
