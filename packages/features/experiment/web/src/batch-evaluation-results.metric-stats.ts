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
  return (
    sortedValues[lower]! + (sortedValues[upper]! - sortedValues[lower]!) * (index - lower)
  );
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
