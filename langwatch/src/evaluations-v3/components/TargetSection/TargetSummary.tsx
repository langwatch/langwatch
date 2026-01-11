import { Box, Circle, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { memo } from "react";
import { LuChevronRight, LuClock, LuTriangleRight, LuZap } from "react-icons/lu";

import { Tooltip } from "~/components/ui/tooltip";
import type { MetricStats, TargetAggregate } from "../../utils/computeAggregates";
import {
  formatCost,
  formatLatency,
  formatPassRate,
  formatScore,
} from "../../utils/computeAggregates";

/**
 * Renders a statistical breakdown tooltip for latency.
 */
const LatencyStatsTooltip = ({ stats }: { stats: MetricStats }) => (
  <VStack align="stretch" gap={1} fontSize="11px" minWidth="140px">
    <HStack justify="space-between">
      <Text color="white/60">Min</Text>
      <Text>{formatLatency(stats.min)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">Avg</Text>
      <Text>{formatLatency(stats.avg)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">Median (p50)</Text>
      <Text>{formatLatency(stats.median)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">p75</Text>
      <Text>{formatLatency(stats.p75)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">p90</Text>
      <Text>{formatLatency(stats.p90)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">p95</Text>
      <Text>{formatLatency(stats.p95)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">p99</Text>
      <Text>{formatLatency(stats.p99)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">Max</Text>
      <Text>{formatLatency(stats.max)}</Text>
    </HStack>
    <Box borderTopWidth="1px" borderColor="gray.500" marginY={1} />
    <HStack justify="space-between">
      <Text color="white/60">Total</Text>
      <Text fontWeight="medium">{formatLatency(stats.total)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">Count</Text>
      <Text>{stats.count}</Text>
    </HStack>
  </VStack>
);

/**
 * Renders a statistical breakdown tooltip for cost.
 */
const CostStatsTooltip = ({ stats }: { stats: MetricStats }) => (
  <VStack align="stretch" gap={1} fontSize="11px" minWidth="140px">
    <HStack justify="space-between">
      <Text color="white/60">Min</Text>
      <Text>{formatCost(stats.min)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">Avg</Text>
      <Text>{formatCost(stats.avg)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">Median (p50)</Text>
      <Text>{formatCost(stats.median)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">p75</Text>
      <Text>{formatCost(stats.p75)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">p90</Text>
      <Text>{formatCost(stats.p90)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">p95</Text>
      <Text>{formatCost(stats.p95)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">p99</Text>
      <Text>{formatCost(stats.p99)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">Max</Text>
      <Text>{formatCost(stats.max)}</Text>
    </HStack>
    <Box borderTopWidth="1px" borderColor="gray.500" marginY={1} />
    <HStack justify="space-between">
      <Text color="white/60">Total</Text>
      <Text fontWeight="medium">{formatCost(stats.total)}</Text>
    </HStack>
    <HStack justify="space-between">
      <Text color="white/60">Count</Text>
      <Text>{stats.count}</Text>
    </HStack>
  </VStack>
);

/**
 * Get a color that interpolates from red (0%) to orange (50%) to green (100%)
 * based on the pass rate percentage.
 */
const getPassRateGradientColor = (passRate: number): string => {
  // Clamp to 0-100
  const rate = Math.max(0, Math.min(100, passRate));

  if (rate <= 50) {
    // Red to Orange: 0% = red, 50% = orange
    // Red: rgb(239, 68, 68) -> Orange: rgb(245, 158, 11)
    const t = rate / 50;
    const r = Math.round(239 + (245 - 239) * t);
    const g = Math.round(68 + (158 - 68) * t);
    const b = Math.round(68 + (11 - 68) * t);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // Orange to Green: 50% = orange, 100% = green
    // Orange: rgb(245, 158, 11) -> Green: rgb(34, 197, 94)
    const t = (rate - 50) / 50;
    const r = Math.round(245 + (34 - 245) * t);
    const g = Math.round(158 + (197 - 158) * t);
    const b = Math.round(11 + (94 - 11) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }
};

/**
 * Colored circle indicator for pass rate.
 * Size is slightly larger than default (10px vs 8px).
 */
const PassRateCircle = ({
  passRate,
  size = "10px",
}: {
  passRate: number;
  size?: string;
}) => (
  <Circle size={size} bg={getPassRateGradientColor(passRate)} flexShrink={0} />
);

type TargetSummaryProps = {
  aggregates: TargetAggregate;
  isRunning?: boolean;
};

/**
 * Compact summary display for target evaluation results.
 * Shows pass rate and score inline, with a hover tooltip for full details.
 */
export const TargetSummary = memo(function TargetSummary({
  aggregates,
  isRunning = false,
}: TargetSummaryProps) {
  // Show summary if we have any completed rows, OR any errors, OR any metrics
  const hasResults =
    aggregates.completedRows > 0 ||
    aggregates.errorRows > 0 ||
    aggregates.totalCost !== null;

  // Build tooltip content
  const tooltipContent = (
    <VStack
      align="stretch"
      gap={0}
      fontSize="12px"
      minWidth="230px"
      color="white"
    >
      <VStack align="stretch" gap={2} padding={2}>
        {/* Progress */}
        <HStack justify="space-between">
          <Text color="white/75">Rows</Text>
          <Text fontWeight="medium">
            {aggregates.completedRows}/{aggregates.totalRows}
            {aggregates.errorRows > 0 && (
              <Text as="span" color="red.300" marginLeft={1}>
                ({aggregates.errorRows}{" "}
                {aggregates.errorRows === 1 ? "error" : "errors"})
              </Text>
            )}
          </Text>
        </HStack>

        {/* Pass Rate */}
        {aggregates.overallPassRate !== null && (
          <HStack justify="space-between">
            <Text color="white/75">Pass Rate</Text>
            <HStack gap={1.5}>
              <PassRateCircle passRate={aggregates.overallPassRate} />
              <Text
                fontWeight="medium"
                color={getPassRateGradientColor(aggregates.overallPassRate)}
              >
                {formatPassRate(aggregates.overallPassRate)}
              </Text>
            </HStack>
          </HStack>
        )}

        {/* Average Score */}
        {aggregates.overallAverageScore !== null && (
          <HStack justify="space-between">
            <Text color="white/75">Avg Score</Text>
            <Text fontWeight="medium">
              {formatScore(aggregates.overallAverageScore)}
            </Text>
          </HStack>
        )}

        {/* Average Latency - with stats breakdown */}
        {aggregates.latencyStats && (
          <Tooltip
            content={<LatencyStatsTooltip stats={aggregates.latencyStats} />}
            positioning={{ placement: "right" }}
            openDelay={100}
            interactive
          >
            <HStack
              justify="space-between"
              cursor="pointer"
              _hover={{ bg: "white/10" }}
              marginX={-2}
              paddingX={2}
              paddingY={0.5}
              borderRadius="md"
            >
              <Text color="white/75">Avg Latency</Text>
              <HStack gap={1}>
                <Icon as={LuClock} color="gray.300" boxSize={3} />
                <Text fontWeight="medium">
                  {formatLatency(aggregates.averageLatency)}
                </Text>
                <Icon as={LuChevronRight} boxSize={3} color="white/50" />
              </HStack>
            </HStack>
          </Tooltip>
        )}

        {/* Total Cost - with stats breakdown */}
        {aggregates.costStats && (
          <Tooltip
            content={<CostStatsTooltip stats={aggregates.costStats} />}
            positioning={{ placement: "right" }}
            openDelay={100}
            interactive
          >
            <HStack
              justify="space-between"
              cursor="pointer"
              _hover={{ bg: "white/10" }}
              marginX={-2}
              paddingX={2}
              paddingY={0.5}
              borderRadius="md"
            >
              <Text color="white/75">Total Cost</Text>
              <HStack gap={1}>
                <Text fontWeight="medium">
                  {formatCost(aggregates.totalCost)}
                </Text>
                <Icon as={LuChevronRight} boxSize={3} color="white/50" />
              </HStack>
            </HStack>
          </Tooltip>
        )}

        {/* Total Execution Time */}
        {aggregates.totalDuration !== null && (
          <HStack justify="space-between">
            <Text color="white/75">Execution Time</Text>
            <Text fontWeight="medium">
              {formatLatency(aggregates.totalDuration)}
            </Text>
          </HStack>
        )}
      </VStack>

      {/* Per-evaluator breakdown */}
      {aggregates.evaluators.length > 0 && (
        <>
          <Box borderTopWidth="1px" borderColor="gray.500" />
          <VStack align="stretch" gap={2} padding={2}>
            <Text color="white/85" fontWeight="semibold">
              Evaluators
            </Text>
            {aggregates.evaluators.map((evaluator) => (
              <HStack key={evaluator.evaluatorId} justify="space-between">
                <Text color="white/75" truncate maxWidth="150px">
                  {evaluator.evaluatorName}
                </Text>
                <HStack gap={2}>
                  {evaluator.passRate !== null && (
                    <HStack gap={1}>
                      <PassRateCircle
                        passRate={evaluator.passRate}
                        size="8px"
                      />
                      <Text
                        fontSize="11px"
                        color={getPassRateGradientColor(evaluator.passRate)}
                      >
                        {formatPassRate(evaluator.passRate)}
                      </Text>
                    </HStack>
                  )}
                  {evaluator.averageScore !== null && (
                    <Text fontSize="11px" color="gray.200">
                      {formatScore(evaluator.averageScore)}
                    </Text>
                  )}
                  {evaluator.errors > 0 && (
                    <Text fontSize="11px" color="red.300">
                      {evaluator.errors}{" "}
                      {evaluator.errors === 1 ? "error" : "errors"}
                    </Text>
                  )}
                </HStack>
              </HStack>
            ))}
          </VStack>
        </>
      )}
    </VStack>
  );

  // Don't show anything if no results yet
  if (!hasResults && !isRunning) {
    return null;
  }

  return (
    <Tooltip
      content={tooltipContent}
      contentProps={{ padding: 0 }}
      positioning={{ placement: "bottom" }}
      openDelay={100}
      closeDelay={100}
      interactive
    >
      <HStack
        gap={2}
        fontSize="12px"
        color="gray.500"
        paddingX={2}
        paddingY={1}
        borderRadius="lg"
        border="1px solid"
        borderColor="gray.200"
        cursor="default"
        _hover={{ borderColor: "gray.300", bg: "gray.50" }}
        data-testid="target-summary"
      >
        {/* Running progress */}
        {isRunning && aggregates.completedRows < aggregates.totalRows && (
          <HStack gap={1}>
            <Icon as={LuZap} boxSize={3} color="blue.500" />
            <Text color="blue.600" fontWeight="medium">
              {aggregates.completedRows}/{aggregates.totalRows}
            </Text>
          </HStack>
        )}

        {(aggregates.overallPassRate !== null ||
          aggregates.overallAverageScore !== null) && (
          <Text fontWeight="600">Score</Text>
        )}

        {/* Pass rate */}
        {aggregates.overallPassRate !== null && (
          <HStack gap={1}>
            <PassRateCircle passRate={aggregates.overallPassRate} />
            <Text
              color={getPassRateGradientColor(aggregates.overallPassRate)}
              fontWeight="medium"
            >
              {formatPassRate(aggregates.overallPassRate)}
            </Text>
          </HStack>
        )}

        {/* Average score */}
        {aggregates.overallAverageScore !== null && (
          <HStack gap={1}>
            <LuTriangleRight />
            <Text color="gray.600">
              {formatScore(aggregates.overallAverageScore)}
            </Text>
          </HStack>
        )}

        {/* Average latency (compact) - with caret to indicate more details */}
        {aggregates.averageLatency !== null && (
          <HStack gap={1}>
            <LuClock />
            <Text fontWeight="medium">
              {formatLatency(aggregates.averageLatency)}
            </Text>
            {aggregates.latencyStats && (
              <LuChevronRight size={12} style={{ opacity: 0.5 }} />
            )}
          </HStack>
        )}

        {/* Total cost - show when no evaluators (so there's no pass rate/score to show) */}
        {aggregates.totalCost !== null &&
          aggregates.overallPassRate === null &&
          aggregates.overallAverageScore === null &&
          !isRunning && (
            <HStack gap={1}>
              <Text color="gray.500">{formatCost(aggregates.totalCost)}</Text>
              {aggregates.costStats && (
                <LuChevronRight size={12} style={{ opacity: 0.5 }} />
              )}
            </HStack>
          )}

        {/* Errors indicator */}
        {aggregates.errorRows > 0 && (
          <Text color="red.500" fontWeight="medium">
            {aggregates.errorRows}{" "}
            {aggregates.errorRows === 1 ? "error" : "errors"}
          </Text>
        )}
      </HStack>
    </Tooltip>
  );
});
