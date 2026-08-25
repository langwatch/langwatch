/**
 * MetricStatsTooltip - Statistical breakdown tooltips for latency and cost.
 *
 * Shared between Evaluations V3 TargetSummary and Batch Results.
 */
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { computeMetricStats, type MetricStats } from "@langwatch/experiment-web";
import { formatCost, formatLatency } from "./formatters";

export { computeMetricStats, type MetricStats };

type MetricStatsTooltipProps = {
  stats: MetricStats;
  /** Formatter function for the values */
  formatValue: (value: number | null) => string;
};

/**
 * Generic statistical breakdown tooltip content.
 */
export const MetricStatsTooltip = ({ stats, formatValue }: MetricStatsTooltipProps) => (
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
