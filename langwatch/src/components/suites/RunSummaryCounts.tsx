/**
 * Compact status badges for run/group row headers.
 *
 * Shows non-zero counts as colored badges with labels.
 * Passed and failed always show (even when zero) for clarity;
 * stalled, cancelled, running, queued only appear when > 0.
 */

import { HStack, Text } from "@chakra-ui/react";
import { Tooltip } from "../ui/tooltip";
import { Check, X, AlertTriangle, Ban, Loader, Clock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { RunGroupSummary } from "./run-history-transforms";

type RunSummaryCountsProps = {
  summary: RunGroupSummary;
};

function CountBadge({
  count,
  label,
  tooltip,
  icon: Icon,
  color,
  bg,
}: {
  count: number;
  label: string;
  tooltip: string;
  icon: LucideIcon;
  color: string;
  bg: string;
}) {
  return (
    <Tooltip content={tooltip}>
      <HStack
        gap="4px"
        paddingX="8px"
        paddingY="2px"
        borderRadius="md"
        bg={bg}
      >
        <Icon size={12} style={{ color: `var(--chakra-colors-${color})` }} />
        <Text fontSize="xs" fontWeight="semibold" color={color} whiteSpace="nowrap">
          {count} {label}
        </Text>
      </HStack>
    </Tooltip>
  );
}

export function RunSummaryCounts({ summary }: RunSummaryCountsProps) {
  const finishedCount =
    summary.passedCount +
    summary.failedCount +
    summary.stalledCount +
    summary.cancelledCount;

  const hasFinished = finishedCount > 0;

  return (
    <HStack gap={1} data-testid="run-summary-counts">
      {/* Always show passed/failed for finished runs */}
      {hasFinished && (
        <>
          <CountBadge
            count={summary.passedCount}
            label="passed"
            tooltip={`${summary.passedCount} scenario${summary.passedCount !== 1 ? "s" : ""} passed all criteria`}
            icon={Check}
            color="green.fg"
            bg="green.subtle"
          />
          <CountBadge
            count={summary.failedCount}
            label="failed"
            tooltip={`${summary.failedCount} scenario${summary.failedCount !== 1 ? "s" : ""} failed one or more criteria`}
            icon={X}
            color="red.fg"
            bg="red.subtle"
          />
        </>
      )}

      {summary.stalledCount > 0 && (
        <CountBadge
          count={summary.stalledCount}
          label="stalled"
          tooltip={`${summary.stalledCount} scenario${summary.stalledCount !== 1 ? "s" : ""} stalled (no response received)`}
          icon={AlertTriangle}
          color="yellow.fg"
          bg="yellow.subtle"
        />
      )}

      {summary.cancelledCount > 0 && (
        <CountBadge
          count={summary.cancelledCount}
          label="cancelled"
          tooltip={`${summary.cancelledCount} scenario${summary.cancelledCount !== 1 ? "s" : ""} were cancelled`}
          icon={Ban}
          color="fg.muted"
          bg="bg.emphasized"
        />
      )}

      {summary.inProgressCount > 0 && (
        <CountBadge
          count={summary.inProgressCount}
          label="running"
          tooltip={`${summary.inProgressCount} scenario${summary.inProgressCount !== 1 ? "s" : ""} currently executing`}
          icon={Loader}
          color="orange.fg"
          bg="orange.subtle"
        />
      )}

      {summary.queuedCount > 0 && (
        <CountBadge
          count={summary.queuedCount}
          label="queued"
          tooltip={`${summary.queuedCount} scenario${summary.queuedCount !== 1 ? "s" : ""} waiting to execute`}
          icon={Clock}
          color="blue.fg"
          bg="blue.subtle"
        />
      )}
    </HStack>
  );
}
