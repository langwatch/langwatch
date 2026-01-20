/**
 * BatchTargetHeader - Header component for target columns in batch results table.
 *
 * Shows target name with icon and summary statistics (similar to V3 TargetHeader).
 */
import { Box, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { memo } from "react";
import {
  LuChevronRight,
  LuClock,
  LuCode,
  LuFileText,
  LuTriangleRight,
} from "react-icons/lu";
import {
  formatCost,
  formatLatency,
  formatScore,
} from "~/components/shared/formatters";
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
import { ColorfulBlockIcon } from "~/optimization_studio/components/ColorfulBlockIcons";
import type { BatchTargetAggregate } from "./computeBatchAggregates";
import type { BatchTargetColumn } from "./types";

type BatchTargetHeaderProps = {
  target: BatchTargetColumn;
  aggregates: BatchTargetAggregate | null;
  /** Color indicator to show next to target name (for chart correlation) */
  colorIndicator?: string;
};

/**
 * Formats a pass rate for display.
 */
const formatPassRate = (passRate: number | null): string => {
  if (passRate === null) return "-";
  return `${Math.round(passRate)}%`;
};

/**
 * Summary statistics tooltip content.
 */
const SummaryTooltipContent = ({
  aggregates,
}: {
  aggregates: BatchTargetAggregate;
}) => (
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
                    <PassRateCircle passRate={evaluator.passRate} size="8px" />
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

/**
 * Compact summary badge shown in header.
 *
 * NOTE: We manually control tooltip open/close state with useInteractiveTooltip
 * because this tooltip contains nested tooltips (for latency/cost stats).
 * Chakra's built-in interactive behavior conflicts with nested tooltips,
 * so we handle the hover logic ourselves via contentProps mouse handlers.
 */
const SummaryBadge = memo(function SummaryBadge({
  aggregates,
}: {
  aggregates: BatchTargetAggregate;
}) {
  const hasResults =
    aggregates.completedRows > 0 ||
    aggregates.errorRows > 0 ||
    aggregates.totalCost !== null;

  const { isOpen, handleMouseEnter, handleMouseLeave } =
    useInteractiveTooltip(150);

  if (!hasResults) return null;

  return (
    <Tooltip
      content={<SummaryTooltipContent aggregates={aggregates} />}
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
        fontSize="11px"
        color="gray.500"
        paddingX={2}
        paddingY={0.5}
        borderRadius="lg"
        border="1px solid"
        borderColor="gray.200"
        cursor="default"
        _hover={{ borderColor: "gray.300", bg: "gray.50" }}
        data-testid="target-summary-badge"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
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

        {/* Average latency (compact) */}
        {aggregates.averageLatency !== null && (
          <HStack gap={1}>
            <LuClock size={12} />
            <Text fontWeight="medium">
              {formatLatency(aggregates.averageLatency)}
            </Text>
          </HStack>
        )}

        {/* Total cost - show when no evaluators */}
        {aggregates.totalCost !== null &&
          aggregates.overallPassRate === null &&
          aggregates.overallAverageScore === null && (
            <HStack gap={1}>
              <Text color="gray.500">{formatCost(aggregates.totalCost)}</Text>
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

/**
 * Target header with name, icon, and summary statistics.
 */
export const BatchTargetHeader = memo(function BatchTargetHeader({
  target,
  aggregates,
  colorIndicator,
}: BatchTargetHeaderProps) {
  // Determine icon based on target type
  const getTargetIcon = () => {
    if (target.type === "prompt") {
      return <LuFileText size={12} />;
    }
    if (target.type === "agent") {
      return <LuCode size={12} />;
    }
    // Legacy type - use generic icon
    return <LuFileText size={12} />;
  };

  const getTargetColor = () => {
    if (target.type === "prompt") return "green.400";
    if (target.type === "agent") return "#3E5A60";
    return "gray.400";
  };

  return (
    <HStack gap={2} width="full">
      <HStack gap={2} flex={1} minWidth={0}>
        {/* Color indicator for chart correlation */}
        {colorIndicator && (
          <Box
            width="10px"
            height="10px"
            borderRadius="sm"
            bg={colorIndicator}
            flexShrink={0}
          />
        )}
        <ColorfulBlockIcon
          color={getTargetColor()}
          size="xs"
          icon={getTargetIcon()}
        />
        <Text fontSize="13px" fontWeight="medium" truncate>
          {target.name}
        </Text>
      </HStack>

      {/* Summary badge */}
      {aggregates && <SummaryBadge aggregates={aggregates} />}
    </HStack>
  );
});
