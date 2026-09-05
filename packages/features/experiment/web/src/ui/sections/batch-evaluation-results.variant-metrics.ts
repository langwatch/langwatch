/**
 * Per-variant cost/duration aggregation for the Comparison leaderboard's cost/duration
 * tradeoff chart (#5103) — how much a candidate typically costs and how long it takes,
 * across the rows it participated in.
 */
import {
  computeMetricStats,
  type MetricStats,
} from "../../model/batch-evaluation-results.metric-stats";
import { bootstrapMeanCI } from "../../model/batch-evaluation-results.bootstrap-ci";
import type { BatchResultRow } from "./batch-evaluation-results.types";

export type VariantMetrics = {
  variantId: string;
  costStats: MetricStats | null;
  durationStats: MetricStats | null;
  /**
   * 95% CI for the MEAN cost, not the spread of the rows.
   */
  costMeanCI: [number, number] | null;
  /** 95% CI for the mean duration, on the same terms as `costMeanCI`. */
  durationMeanCI: [number, number] | null;
  /**
   * 95% CI for the mean per-row cost difference against each other variant, keyed by
   * that variant's id. `costDifferenceCI[other]` is this variant's cost minus that
   * one's, so an interval entirely below zero means this one is genuinely cheaper.
   */
  costDifferenceCI: Record<string, [number, number]>;
  /** The same for duration. */
  durationDifferenceCI: Record<string, [number, number]>;
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

/**
 * Rows a metric needs before it may carry a claim.
 */
export const MIN_PRICED_ROWS = 5;

/** Per-row value for a variant, `null` where the row recorded nothing. */
const readByRow = ({
  rows,
  variantId,
  metric,
}: {
  rows: BatchResultRow[];
  variantId: string;
  metric: "cost" | "duration";
}): Array<number | null> =>
  rows.map((row) => {
    const target = row.targets[variantId];
    const value = target ? target[metric] : null;
    return value === null || value === void 0 || !Number.isFinite(value) ? null : value;
  });

/**
 * Interval for the mean per-row DIFFERENCE between two variants, over the rows where
 * both recorded a value.
 */
const pairedDifferenceCI = ({
  a,
  b,
  seed,
}: {
  a: Array<number | null>;
  b: Array<number | null>;
  seed: number;
}): [number, number] | null => {
  const differences: number[] = [];
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (left === null || right === null) continue;
    if (left === void 0 || right === void 0) continue;
    differences.push(left - right);
  }
  // The per-variant floor is not enough on its own. Two variants can each clear it
  // comfortably and still SHARE almost no rows — priced on different halves of the run
  // — and the paired sample is what this interval is actually built from.
  if (differences.length < MIN_PRICED_ROWS) return null;
  return bootstrapMeanCI({ values: differences, seed });
};

/**
 * Every pair's interval, computed once per UNORDERED pair and mirrored exactly.
 */
const pairedDifferenceCIs = ({
  variantIds,
  valuesByRow,
}: {
  variantIds: string[];
  valuesByRow: Record<string, Array<number | null>>;
}): Record<string, Record<string, [number, number]>> => {
  const byVariant: Record<string, Record<string, [number, number]>> = {};
  for (const variantId of variantIds) {
    byVariant[variantId] = {};
  }

  for (let i = 0; i < variantIds.length; i++) {
    for (let j = i + 1; j < variantIds.length; j++) {
      const left = variantIds[i]!;
      const right = variantIds[j]!;
      // NUL rather than a space: variant ids are free-form, and with a
      // space "a b" + "c" and "a" + "b c" hash to the same seed.
      const seed = seedFor(`${left}\u0000${right}`);

      const difference = pairedDifferenceCI({
        a: valuesByRow[left]!,
        b: valuesByRow[right]!,
        seed,
      });
      if (!difference) continue;

      byVariant[left]![right] = difference;
      byVariant[right]![left] = [-difference[1], -difference[0]];
    }
  }

  return byVariant;
};

export function computeVariantMetrics({
  variantIds,
  rows,
}: {
  variantIds: string[];
  rows: BatchResultRow[];
}): Record<string, VariantMetrics> {
  const result: Record<string, VariantMetrics> = {};

  const costByRow: Record<string, Array<number | null>> = {};
  const durationByRow: Record<string, Array<number | null>> = {};
  for (const variantId of variantIds) {
    costByRow[variantId] = readByRow({ rows, variantId, metric: "cost" });
    durationByRow[variantId] = readByRow({
      rows,
      variantId,
      metric: "duration",
    });
  }

  const costDifferenceCI = pairedDifferenceCIs({
    variantIds,
    valuesByRow: costByRow,
  });
  const durationDifferenceCI = pairedDifferenceCIs({
    variantIds,
    valuesByRow: durationByRow,
  });

  for (const variantId of variantIds) {
    const costs = costByRow[variantId]!.filter((v): v is number => v !== null);
    const durations = durationByRow[variantId]!.filter((v): v is number => v !== null);

    result[variantId] = {
      variantId,
      costStats: computeMetricStats(costs),
      durationStats: computeMetricStats(durations),
      // Seeded per variant so a variant's interval is stable across renders and across
      // which other variants happen to be in the run, but two variants do not share a
      // resampling pattern.
      costMeanCI: bootstrapMeanCI({ values: costs, seed: seedFor(variantId) }),
      durationMeanCI: bootstrapMeanCI({
        values: durations,
        seed: seedFor(`${variantId}\u0000duration`),
      }),
      costDifferenceCI: costDifferenceCI[variantId]!,
      durationDifferenceCI: durationDifferenceCI[variantId]!,
    };
  }

  return result;
}
