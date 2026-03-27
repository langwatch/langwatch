/**
 * Compact metrics pill for run/group row headers.
 *
 * Shows pass rate, total duration, and total cost inline.
 * Hover tooltip shows detailed breakdown with expandable
 * percentile distributions for agent latency and cost.
 *
 * Design follows TargetSummary.tsx from the evaluations page.
 */

import { HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { LuChevronRight, LuClock, LuZap } from "react-icons/lu";
import {
  LatencyStatsTooltip,
  CostStatsTooltip,
} from "~/components/shared/MetricStatsTooltip";
import {
  getPassRateGradientColor,
  PassRateCircle,
} from "~/components/shared/PassRateIndicator";
import { formatCost, formatLatency } from "~/components/shared/formatters";
import { Tooltip } from "~/components/ui/tooltip";
import { useInteractiveTooltip } from "~/hooks/useInteractiveTooltip";
import type { RunGroupSummary } from "./run-history-transforms";

type RunMetricsSummaryProps = {
  summary: RunGroupSummary;
};

/**
 * Builds a parenthetical detail string for non-success counts.
 * Example: "(1 failed, 1 stalled, 1 cancelled)"
 */
function buildCompletedDetail(summary: RunGroupSummary): string | null {
  const parts: string[] = [];
  if (summary.failedCount > 0) parts.push(`${summary.failedCount} failed`);
  if (summary.stalledCount > 0) parts.push(`${summary.stalledCount} stalled`);
  if (summary.cancelledCount > 0) parts.push(`${summary.cancelledCount} cancelled`);
  return parts.length > 0 ? `(${parts.join(", ")})` : null;
}

function TooltipContent({ summary }: { summary: RunGroupSummary }) {
  const detail = buildCompletedDetail(summary);

  return (
    <VStack
      align="stretch"
      gap={0}
      fontSize="12px"
      minWidth="220px"
      color="white"
    >
      <VStack align="stretch" gap={2} padding={2}>
        {/* Pass Rate */}
        <HStack justify="space-between">
          <Text color="white/75">Pass</Text>
          <HStack gap={1.5}>
            <PassRateCircle passRate={summary.passRate} />
            <Text
              fontWeight="medium"
              color={getPassRateGradientColor(summary.passRate)}
            >
              {summary.passRate === null ? "-" : `${Math.round(summary.passRate)}%`}
            </Text>
          </HStack>
        </HStack>

        {/* Completed row */}
        <HStack justify="space-between">
          <Text color="white/75">Completed</Text>
          <Text fontWeight="medium">
            {summary.completedCount}/{summary.totalCount}
            {detail && (
              <Text as="span" color="red.300" marginLeft={1}>
                {detail}
              </Text>
            )}
          </Text>
        </HStack>

        {/* Avg Agent Latency — expandable with percentile stats */}
        {summary.agentLatencyStats ? (
          <Tooltip
            content={<LatencyStatsTooltip stats={summary.agentLatencyStats} />}
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
              <Text color="white/75">Avg Agent Latency</Text>
              <HStack gap={1}>
                <Icon as={LuClock} color="white/60" boxSize={3} />
                <Text fontWeight="medium">
                  {formatLatency(summary.averageAgentLatencyMs)}
                </Text>
                <Icon as={LuChevronRight} boxSize={3} color="white/50" />
              </HStack>
            </HStack>
          </Tooltip>
        ) : summary.averageAgentLatencyMs !== null ? (
          <HStack justify="space-between">
            <Text color="white/75">Avg Agent Latency</Text>
            <HStack gap={1}>
              <Icon as={LuClock} color="white/60" boxSize={3} />
              <Text fontWeight="medium">
                {formatLatency(summary.averageAgentLatencyMs)}
              </Text>
            </HStack>
          </HStack>
        ) : null}

        {/* Avg Agent Cost — expandable with percentile stats */}
        {summary.agentCostStats ? (
          <Tooltip
            content={<CostStatsTooltip stats={summary.agentCostStats} />}
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
              <Text color="white/75">Avg Agent Cost</Text>
              <HStack gap={1}>
                <Text fontWeight="medium">
                  {formatCost(summary.averageAgentCost)}
                </Text>
                <Icon as={LuChevronRight} boxSize={3} color="white/50" />
              </HStack>
            </HStack>
          </Tooltip>
        ) : null}

        {/* Total Duration */}
        {summary.totalDurationMs !== null && (
          <HStack justify="space-between">
            <Text color="white/75">Total Duration</Text>
            <Text fontWeight="medium">{formatLatency(summary.totalDurationMs)}</Text>
          </HStack>
        )}

        {/* Total Cost */}
        {summary.totalCost !== null && (
          <HStack justify="space-between">
            <Text color="white/75">Total Cost</Text>
            <Text fontWeight="medium">{formatCost(summary.totalCost)}</Text>
          </HStack>
        )}
      </VStack>
    </VStack>
  );
}

export function RunMetricsSummary({ summary }: RunMetricsSummaryProps) {
  const { isOpen, handleMouseEnter, handleMouseLeave } =
    useInteractiveTooltip(150);

  const isRunning = summary.inProgressCount > 0 || summary.queuedCount > 0;

  return (
    <Tooltip
      content={<TooltipContent summary={summary} />}
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
        data-testid="run-metrics-summary"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        overflow="hidden"
      >
        {/* Running progress indicator */}
        {isRunning && (
          <HStack gap={1}>
            <Icon as={LuZap} boxSize={3} color="blue.fg" />
            <Text color="blue.fg" fontWeight="medium">
              {summary.completedCount}/{summary.totalCount}
            </Text>
          </HStack>
        )}

        {/* Pass rate — shown when there are completed runs (even while running for partial results) */}
        {!isRunning && summary.totalCount > 0 && (
          <>
            <Text fontWeight="600">Pass</Text>
            <HStack gap={1}>
              <PassRateCircle passRate={summary.passRate} />
              <Text
                color={getPassRateGradientColor(summary.passRate)}
                fontWeight="medium"
              >
                {summary.passRate === null ? "-" : `${Math.round(summary.passRate)}%`}
              </Text>
            </HStack>
          </>
        )}
        {isRunning && summary.completedCount > 0 && (
          <>
            <Text fontWeight="600">Pass</Text>
            <HStack gap={1}>
              <PassRateCircle passRate={summary.passRate} />
              <Text
                color={getPassRateGradientColor(summary.passRate)}
                fontWeight="medium"
              >
                {summary.passRate === null ? "-" : `${Math.round(summary.passRate)}%`}
              </Text>
            </HStack>
          </>
        )}

        {/* Total duration */}
        {summary.totalDurationMs !== null && (
          <HStack gap={1}>
            <Icon as={LuClock} boxSize={3} />
            <Text fontWeight="medium">
              {formatLatency(summary.totalDurationMs)}
            </Text>
          </HStack>
        )}

        {/* Total cost */}
        {summary.totalCost !== null && (
          <Text fontWeight="medium">{formatCost(summary.totalCost)}</Text>
        )}
      </HStack>
    </Tooltip>
  );
}
