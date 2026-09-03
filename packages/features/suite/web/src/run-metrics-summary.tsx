/**
 * Compact metrics pill for run/group row headers.
 *
 * Shows pass rate, total duration, and total cost inline.
 * Hover tooltip shows detailed breakdown with expandable
 * percentile distributions for agent latency and cost.
 *
 * Design follows TargetSummary.tsx from the evaluations page.
 */

import { Box, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { ChevronRight, Clock, Zap } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { formatCost, formatLatency } from "./formatters";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { RunGroupSummary } from "./run-history-transforms";

function getPassRateGradientColor(passRate: number | null): string {
  if (passRate === null) return "gray.400";
  if (passRate <= 50) return "orange.500";
  return "green.500";
}

function PassRateCircle({ passRate }: { passRate: number | null }) {
  return (
    <Box
      width="10px"
      height="10px"
      borderRadius="full"
      bg={getPassRateGradientColor(passRate)}
      flexShrink={0}
    />
  );
}

function StatsTooltip({
  label,
  average,
  percentile,
}: {
  label: string;
  average: number | null;
  percentile: number | undefined;
}) {
  return (
    <VStack align="start" padding={2} gap={1} fontSize="xs">
      <Text>{label}</Text>
      <Text>Average: {label === "Latency" ? formatLatency(average) : formatCost(average)}</Text>
      {percentile !== void 0 && (
        <Text>p95: {label === "Latency" ? formatLatency(percentile) : formatCost(percentile)}</Text>
      )}
    </VStack>
  );
}

type RunMetricsSummaryProps = {
  summary: RunGroupSummary;
  /**
   * How tall the pill is drawn. "md" matches the 32px controls of a header
   * line, so the pill sits level with the buttons beside it.
   */
  size?: "sm" | "md";
};

const PILL_SIZES = {
  sm: { height: undefined, paddingX: 2, paddingY: 1, fontSize: "12px" },
  md: { height: "32px", paddingX: 2.5, paddingY: 0, fontSize: "12.5px" },
} as const;

function useInteractiveTooltip(closeDelay: number) {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCloseTimeout = useCallback(() => {
    if (closeTimeout.current) clearTimeout(closeTimeout.current);
    closeTimeout.current = null;
  }, []);
  const handleMouseEnter = useCallback(() => {
    clearCloseTimeout();
    setIsOpen(true);
  }, [clearCloseTimeout]);
  const handleMouseLeave = useCallback(() => {
    clearCloseTimeout();
    closeTimeout.current = setTimeout(() => setIsOpen(false), closeDelay);
  }, [clearCloseTimeout, closeDelay]);
  return { isOpen, handleMouseEnter, handleMouseLeave };
}

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
    <VStack align="stretch" gap={0} fontSize="12px" minWidth="220px" color="fg">
      <VStack align="stretch" gap={2} padding={2}>
        {/* Pass Rate */}
        <HStack justify="space-between">
          <Text color="fg.muted">Pass</Text>
          <HStack gap={1.5}>
            <PassRateCircle passRate={summary.passRate} />
            <Text fontWeight="medium" color={getPassRateGradientColor(summary.passRate)}>
              {summary.passRate === null ? "-" : `${Math.round(summary.passRate)}%`}
            </Text>
          </HStack>
        </HStack>

        {/* Completed row */}
        <HStack justify="space-between">
          <Text color="fg.muted">Completed</Text>
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
            content={
              <StatsTooltip
                label="Latency"
                average={summary.averageAgentLatencyMs}
                percentile={summary.agentLatencyStats.p95}
              />
            }
            positioning={{ placement: "right" }}
            openDelay={100}
            interactive
          >
            <HStack
              justify="space-between"
              cursor="pointer"
              _hover={{ bg: "bg.muted" }}
              marginX={-2}
              paddingX={2}
              paddingY={0.5}
              borderRadius="md"
            >
              <Text color="fg.muted">Avg Agent Latency</Text>
              <HStack gap={1}>
                <Icon as={Clock} color="fg.muted" boxSize={3} />
                <Text fontWeight="medium">{formatLatency(summary.averageAgentLatencyMs)}</Text>
                <Icon as={ChevronRight} boxSize={3} color="fg.subtle" />
              </HStack>
            </HStack>
          </Tooltip>
        ) : summary.averageAgentLatencyMs !== null ? (
          <HStack justify="space-between">
            <Text color="fg.muted">Avg Agent Latency</Text>
            <HStack gap={1}>
              <Icon as={Clock} color="fg.muted" boxSize={3} />
              <Text fontWeight="medium">{formatLatency(summary.averageAgentLatencyMs)}</Text>
            </HStack>
          </HStack>
        ) : null}

        {/* Avg Agent Cost — expandable with percentile stats */}
        {summary.agentCostStats ? (
          <Tooltip
            content={
              <StatsTooltip
                label="Cost"
                average={summary.averageAgentCost}
                percentile={summary.agentCostStats.p95}
              />
            }
            positioning={{ placement: "right" }}
            openDelay={100}
            interactive
          >
            <HStack
              justify="space-between"
              cursor="pointer"
              _hover={{ bg: "bg.muted" }}
              marginX={-2}
              paddingX={2}
              paddingY={0.5}
              borderRadius="md"
            >
              <Text color="fg.muted">Avg Agent Cost</Text>
              <HStack gap={1}>
                <Text fontWeight="medium">{formatCost(summary.averageAgentCost)}</Text>
                <Icon as={ChevronRight} boxSize={3} color="fg.subtle" />
              </HStack>
            </HStack>
          </Tooltip>
        ) : null}

        {/* Total Duration */}
        {summary.totalDurationMs !== null && (
          <HStack justify="space-between">
            <Text color="fg.muted">Total Duration</Text>
            <Text fontWeight="medium">{formatLatency(summary.totalDurationMs)}</Text>
          </HStack>
        )}

        {/* Total Cost */}
        {summary.totalCost !== null && (
          <HStack justify="space-between">
            <Text color="fg.muted">Total Cost</Text>
            <Text fontWeight="medium">{formatCost(summary.totalCost)}</Text>
          </HStack>
        )}
      </VStack>
    </VStack>
  );
}

export function RunMetricsSummary({ summary, size = "sm" }: RunMetricsSummaryProps) {
  const { isOpen, handleMouseEnter, handleMouseLeave } = useInteractiveTooltip(150);
  const pill = PILL_SIZES[size];
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
        fontSize={pill.fontSize}
        color="fg.muted"
        height={pill.height}
        paddingX={pill.paddingX}
        paddingY={pill.paddingY}
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
            <Icon as={Zap} boxSize={3} color="blue.fg" />
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
              <Text color={getPassRateGradientColor(summary.passRate)} fontWeight="medium">
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
              <Text color={getPassRateGradientColor(summary.passRate)} fontWeight="medium">
                {summary.passRate === null ? "-" : `${Math.round(summary.passRate)}%`}
              </Text>
            </HStack>
          </>
        )}

        {/* Total duration */}
        {summary.totalDurationMs !== null && (
          <HStack gap={1}>
            <Icon as={Clock} boxSize={3} />
            <Text fontWeight="medium">{formatLatency(summary.totalDurationMs)}</Text>
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
