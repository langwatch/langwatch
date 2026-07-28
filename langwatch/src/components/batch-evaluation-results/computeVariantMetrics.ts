/**
 * Per-variant cost/duration aggregation for the Comparison leaderboard's
 * cost/duration tradeoff chart (#5103) — how much a candidate typically
 * costs and how long it takes, across the rows it participated in.
 *
 * Cost and duration are kept as full distributions (via the same
 * `computeMetricStats` used elsewhere for latency/cost) rather than a single
 * mean, so a "cheaper" claim isn't hiding its own spread.
 */
import {
  computeMetricStats,
  type MetricStats,
} from "~/components/shared/MetricStatsTooltip";
import { bootstrapMeanCI } from "./bootstrapMeanCI";
import type { BatchResultRow } from "./types";

export type VariantMetrics = {
  variantId: string;
  costStats: MetricStats | null;
  durationStats: MetricStats | null;
  /**
   * 95% CI for the MEAN cost, not the spread of the rows.
   *
   * `costStats` already describes the distribution, which answers "what does
   * a row typically cost". This answers the different question the trade-off
   * chart actually asks — "how well do we know this variant's cost" — and it
   * is the one that belongs next to a confidence interval on the other axis.
   * Null when too few rows carried a price to resample.
   */
  costMeanCI: [number, number] | null;
  /** 95% CI for the mean duration, on the same terms as `costMeanCI`. */
  durationMeanCI: [number, number] | null;
};

/**
 * A stable seed from the variant id, so the same variant resamples the same
 * way every render. A fixed constant would make every variant draw the same
 * index pattern, which correlates their intervals for no reason.
 */
const seedFor = (variantId: string): number => {
  let h = 2166136261;
  for (let i = 0; i < variantId.length; i++) {
    h ^= variantId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 1;
};

export function computeVariantMetrics({
  variantIds,
  rows,
}: {
  variantIds: string[];
  rows: BatchResultRow[];
}): Record<string, VariantMetrics> {
  const result: Record<string, VariantMetrics> = {};

  for (const variantId of variantIds) {
    const costs: number[] = [];
    const durations: number[] = [];

    for (const row of rows) {
      const target = row.targets[variantId];
      if (!target) continue;
      if (target.cost !== null && target.cost !== undefined) {
        costs.push(target.cost);
      }
      if (target.duration !== null && target.duration !== undefined) {
        durations.push(target.duration);
      }
    }

    result[variantId] = {
      variantId,
      costStats: computeMetricStats(costs),
      durationStats: computeMetricStats(durations),
      // Seeded per variant so a variant's interval is stable across renders
      // and across which other variants happen to be in the run, but two
      // variants do not share a resampling pattern.
      costMeanCI: bootstrapMeanCI({ values: costs, seed: seedFor(variantId) }),
      durationMeanCI: bootstrapMeanCI({
        values: durations,
        seed: seedFor(variantId),
      }),
    };
  }

  return result;
}
