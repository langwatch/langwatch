/**
 * Inline summary counts for run/group row headers.
 *
 * Displays passed/failed counts and optionally stalled/cancelled
 * when non-zero. Designed to sit inside an HStack header alongside
 * existing pass rate percentage and status icon.
 */

import { HStack, Text } from "@chakra-ui/react";
import type { RunGroupSummary } from "./run-history-transforms";

type RunSummaryCountsProps = {
  summary: RunGroupSummary;
};

export function RunSummaryCounts({ summary }: RunSummaryCountsProps) {
  return (
    <HStack gap={2} data-testid="run-summary-counts">
      <Text fontSize="xs" color="green.600">
        {summary.passedCount} passed
      </Text>
      <Text fontSize="xs" color="red.600">
        {summary.failedCount} failed
      </Text>
      {summary.stalledCount > 0 && (
        <Text fontSize="xs" color="yellow.600">
          {summary.stalledCount} stalled
        </Text>
      )}
      {summary.cancelledCount > 0 && (
        <Text fontSize="xs" color="fg.muted">
          {summary.cancelledCount} cancelled
        </Text>
      )}
    </HStack>
  );
}
