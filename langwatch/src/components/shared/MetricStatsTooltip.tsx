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
      <Text color="white/60">Min</Text>
      <Text>{formatValue(stats.min)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">Avg</Text>
      <Text>{formatValue(stats.avg)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">Median (p50)</Text>
      <Text>{formatValue(stats.median)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">p75</Text>
      <Text>{formatValue(stats.p75)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">p90</Text>
      <Text>{formatValue(stats.p90)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">p95</Text>
      <Text>{formatValue(stats.p95)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">p99</Text>
      <Text>{formatValue(stats.p99)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">Max</Text>
      <Text>{formatValue(stats.max)}</Text>
    </HStack>
    <Box borderTopWidth="1px" borderColor="gray.500" marginY={1} />
    <HStack justify="space-between">
      <Text color="white/60">Total</Text>
      <Text fontWeight="medium">{formatValue(stats.total)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">Count</Text>
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
