/**
 * Compact inline summary counts for run/group row headers.
 *
 * Displays counts with status icons (✓ passed, ✗ failed, ⏸ stalled, ⊘ cancelled).
 * Only renders statuses with non-zero counts to keep the display minimal.
 */

import { HStack, Text } from "@chakra-ui/react";
import type { RunGroupSummary } from "./run-history-transforms";

type RunSummaryCountsProps = {
  summary: RunGroupSummary;
};

export function RunSummaryCounts({ summary }: RunSummaryCountsProps) {
  return (
    <HStack gap={2} data-testid="run-summary-counts">
      {summary.passedCount > 0 && (
        <Text fontSize="xs" color="green.600">
          {summary.passedCount} ✓
        </Text>
      )}
      {summary.failedCount > 0 && (
        <Text fontSize="xs" color="red.600">
          {summary.failedCount} ✗
        </Text>
      )}
      {summary.stalledCount > 0 && (
        <Text fontSize="xs" color="yellow.600">
          {summary.stalledCount} ⏸
        </Text>
      )}
      {summary.cancelledCount > 0 && (
        <Text fontSize="xs" color="fg.muted">
          {summary.cancelledCount} ⊘
        </Text>
      )}
    </HStack>
  );
}
