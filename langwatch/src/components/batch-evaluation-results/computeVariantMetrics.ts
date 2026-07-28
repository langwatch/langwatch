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
import type { BatchResultRow } from "./types";

export type VariantMetrics = {
  variantId: string;
  costStats: MetricStats | null;
  durationStats: MetricStats | null;
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
    };
  }

  return result;
}
