export type MetricStats = {
  min: number;
  max: number;
  avg: number;
  median: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  total: number;
  count: number;
};

const percentile = (sortedValues: number[], percentileValue: number): number => {
  const index = (percentileValue / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower]!;
  return sortedValues[lower]! + (sortedValues[upper]! - sortedValues[lower]!) * (index - lower);
};

export const computeMetricStats = (values: number[]): MetricStats | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    avg: total / values.length,
    median: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    total,
    count: values.length,
  };
};

/**
 * The value at a quantile of an ALREADY SORTED sample, interpolating between
 * the two neighbours when the position falls between them.
 *
 * Both places that draw a confidence interval — the bootstrap CI and the
 * Bradley-Terry leaderboard — read their bounds from this, and they must read
 * them the same way or two intervals over the same data disagree. It had been
 * written out in each, identically.
 *
 * The caller sorts. That is not politeness: these are bootstrap resamples in
 * the thousands, and re-sorting per quantile would be the expensive part of
 * drawing an interval that needs two.
 */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  const frac = pos - lo;

  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}
