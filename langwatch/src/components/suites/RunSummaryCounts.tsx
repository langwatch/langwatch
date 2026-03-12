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
  /** Text size for count labels. Defaults to "xs". */
  fontSize?: string;
};

export function RunSummaryCounts({ summary, fontSize = "xs" }: RunSummaryCountsProps) {
  return (
    <HStack gap={2} data-testid="run-summary-counts">
      {summary.passedCount > 0 && (
        <Text fontSize={fontSize} color="green.600">
          {summary.passedCount} ✓
        </Text>
      )}
      {summary.failedCount > 0 && (
        <Text fontSize={fontSize} color="red.600">
          {summary.failedCount} ✗
        </Text>
      )}
      {summary.stalledCount > 0 && (
        <Text fontSize={fontSize} color="yellow.600">
          {summary.stalledCount} ⏸
        </Text>
      )}
      {summary.cancelledCount > 0 && (
        <Text fontSize={fontSize} color="fg.muted">
          {summary.cancelledCount} ⊘
        </Text>
      )}
    </HStack>
  );
}
