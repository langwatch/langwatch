/**
 * Statistical breakdown of a numeric metric (latency, cost).
 *
 * Framework free on purpose: the same numbers are rendered by
 * `MetricStatsTooltip`, aggregated by the evaluations workbench and projected
 * for agents, and the last two of those must never pull React or Chakra in.
 */

export type MetricStats = {
  min: number;
  max: number;
  avg: number;
  median: number; // p50
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  total: number;
  count: number;
};

/**
 * Computes percentile from a sorted array using linear interpolation.
 */
const computePercentile = ({
  sortedValues,
  percentile,
}: {
  sortedValues: number[];
  percentile: number;
}): number => {
  if (sortedValues.length === 0) return 0;
  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower]!;
  return (
    sortedValues[lower]! +
    (sortedValues[upper]! - sortedValues[lower]!) * (index - lower)
  );
};

/**
 * Computes statistical breakdown (min, avg, median, p75, p90, p95, p99, max) for an array of values.
 */
export const computeMetricStats = (values: number[]): MetricStats | null => {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((sum, v) => sum + v, 0);

  return {
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    avg: total / values.length,
    median: computePercentile({ sortedValues: sorted, percentile: 50 }),
    p75: computePercentile({ sortedValues: sorted, percentile: 75 }),
    p90: computePercentile({ sortedValues: sorted, percentile: 90 }),
    p95: computePercentile({ sortedValues: sorted, percentile: 95 }),
    p99: computePercentile({ sortedValues: sorted, percentile: 99 }),
    total,
    count: values.length,
  };
};
