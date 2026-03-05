/**
 * Footer bar showing summary statistics for a run group.
 *
 * Displays total runs, passed, failed, and optionally stalled/cancelled counts.
 * Shared between RunRow and GroupRow.
 */

import { HStack, Text } from "@chakra-ui/react";
import type { RunGroupSummary } from "./run-history-transforms";

type RunSummaryFooterProps = {
  summary: RunGroupSummary;
};

export function RunSummaryFooter({ summary }: RunSummaryFooterProps) {
  return (
    <HStack
      paddingX={4}
      paddingY={2}
      borderBottom="1px solid"
      borderColor="border"
      bg="bg.subtle"
      fontSize="xs"
      color="fg.muted"
      justifyContent="space-between"
    >
      <Text>
        {summary.totalCount} {summary.totalCount === 1 ? "run" : "runs"}
      </Text>
      <HStack gap={3}>
        <Text color="green.600">{summary.passedCount} passed</Text>
        <Text color="red.600">{summary.failedCount} failed</Text>
        {summary.stalledCount > 0 && (
          <Text color="yellow.600">{summary.stalledCount} stalled</Text>
        )}
        {summary.cancelledCount > 0 && (
          <Text color="fg.muted">{summary.cancelledCount} cancelled</Text>
        )}
      </HStack>
    </HStack>
  );
}
