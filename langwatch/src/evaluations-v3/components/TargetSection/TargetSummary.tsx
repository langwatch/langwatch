import { Box, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { memo } from "react";
import {
  LuChevronRight,
  LuClock,
  LuTriangleRight,
  LuZap,
} from "react-icons/lu";
import {
  CostStatsTooltip,
  LatencyStatsTooltip,
} from "~/components/shared/MetricStatsTooltip";
import {
  getPassRateGradientColor,
  PassRateCircle,
} from "~/components/shared/PassRateIndicator";
import { Tooltip } from "~/components/ui/tooltip";
import { useInteractiveTooltip } from "~/hooks/useInteractiveTooltip";
import type { TargetAggregate } from "../../utils/computeAggregates";
import {
  formatCost,
  formatLatency,
  formatPassRate,
  formatScore,
} from "../../utils/computeAggregates";

type TargetSummaryProps = {
  aggregates: TargetAggregate;
  isRunning?: boolean;
};

/**
 * Compact summary display for target evaluation results.
 * Shows pass rate and score inline, with a hover tooltip for full details.
 *
 * NOTE: We manually control tooltip open/close state with useInteractiveTooltip
 * because this tooltip contains nested tooltips (for latency/cost stats).
 * Chakra's built-in interactive behavior conflicts with nested tooltips,
 * so we handle the hover logic ourselves via contentProps mouse handlers.
 */
export const TargetSummary = memo(function TargetSummary({
  aggregates,
  isRunning = false,
}: TargetSummaryProps) {
  const { isOpen, handleMouseEnter, handleMouseLeave } =
    useInteractiveTooltip(150);

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
                <Icon as={LuClock} color="white/60" boxSize={3} />
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
          <Box borderTopWidth="1px" borderColor="border.emphasized" />
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
                    <Text fontSize="11px" color="white/75">
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
      contentProps={{
        padding: 0,
        onMouseEnter: handleMouseEnter,
        onMouseLeave: handleMouseLeave,
      }}
      positioning={{ placement: "bottom" }}
      open={isOpen}
      interactive
    >
      <HStack
        gap={2}
        fontSize="12px"
        color="fg.muted"
        paddingX={2}
        paddingY={1}
        borderRadius="lg"
        border="1px solid"
        borderColor="border"
        cursor="default"
        _hover={{ borderColor: "border.emphasized", bg: "bg.muted" }}
        data-testid="target-summary"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        // minWidth="0"
        overflow="hidden"
      >
        {/* Running progress */}
        {isRunning && aggregates.completedRows < aggregates.totalRows && (
          <HStack gap={1}>
            <Icon as={LuZap} boxSize={3} color="blue.fg" />
            <Text color="blue.fg" fontWeight="medium">
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
            <Text color="fg.muted">
              {formatScore(aggregates.overallAverageScore)}
            </Text>
          </HStack>
        )}

        {/* Average latency (compact) */}
        {aggregates.averageLatency !== null && (
          <HStack gap={1}>
            <LuClock style={{ minWidth: "12px" }} />
            <Text fontWeight="medium">
              {formatLatency(aggregates.averageLatency)}
            </Text>
          </HStack>
        )}

        {/* Total cost - show when no evaluators (so there's no pass rate/score to show) */}
        {aggregates.totalCost !== null &&
          aggregates.overallPassRate === null &&
          aggregates.overallAverageScore === null &&
          !isRunning && (
            <HStack gap={1}>
              <Text color="fg.muted">{formatCost(aggregates.totalCost)}</Text>
            </HStack>
          )}

        {/* Errors indicator */}
        {aggregates.errorRows > 0 && (
          <Text color="red.fg" fontWeight="medium" whiteSpace="nowrap">
            {aggregates.errorRows}{" "}
            {aggregates.errorRows === 1 ? "error" : "errors"}
          </Text>
        )}
      </HStack>
    </Tooltip>
  );
});
