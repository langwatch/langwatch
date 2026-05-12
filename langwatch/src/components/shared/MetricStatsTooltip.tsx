/**
 * MetricStatsTooltip - Statistical breakdown tooltips for latency and cost.
 *
 * Shared between Evaluations V3 TargetSummary and Batch Results.
 */
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { formatCost, formatLatency } from "./formatters";

/**
 * Statistical breakdown for a numeric metric (latency or cost).
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
const computePercentile = (
  sortedValues: number[],
  percentile: number,
): number => {
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
    median: computePercentile(sorted, 50),
    p75: computePercentile(sorted, 75),
    p90: computePercentile(sorted, 90),
    p95: computePercentile(sorted, 95),
    p99: computePercentile(sorted, 99),
    total,
    count: values.length,
  };
};

type MetricStatsTooltipProps = {
  stats: MetricStats;
  /** Formatter function for the values */
  formatValue: (value: number | null) => string;
};

/**
 * Generic statistical breakdown tooltip content.
 */
export const MetricStatsTooltip = ({
  stats,
  formatValue,
}: MetricStatsTooltipProps) => (
  <VStack align="stretch" gap={1} fontSize="11px" minWidth="140px">
    <HStack justify="space-between">
      <Text color="fg.muted">Min</Text>
      <Text>{formatValue(stats.min)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="fg.muted">Avg</Text>
      <Text>{formatValue(stats.avg)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="fg.muted">Median (p50)</Text>
      <Text>{formatValue(stats.median)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="fg.muted">p75</Text>
      <Text>{formatValue(stats.p75)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="fg.muted">p90</Text>
      <Text>{formatValue(stats.p90)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="fg.muted">p95</Text>
      <Text>{formatValue(stats.p95)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="fg.muted">p99</Text>
      <Text>{formatValue(stats.p99)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="fg.muted">Max</Text>
      <Text>{formatValue(stats.max)}</Text>
    </HStack>
    <Box borderTopWidth="1px" borderColor="border.emphasized" marginY={1} />
    <HStack justify="space-between">
      <Text color="fg.muted">Total</Text>
      <Text fontWeight="medium">{formatValue(stats.total)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="fg.muted">Count</Text>
      <Text>{stats.count}</Text>
    </HStack>
  </VStack>
);

/**
 * Latency-specific stats tooltip.
 */
export const LatencyStatsTooltip = ({ stats }: { stats: MetricStats }) => (
  <MetricStatsTooltip stats={stats} formatValue={formatLatency} />
);

/**
 * Cost-specific stats tooltip.
 */
export const CostStatsTooltip = ({ stats }: { stats: MetricStats }) => (
  <MetricStatsTooltip stats={stats} formatValue={formatCost} />
);
