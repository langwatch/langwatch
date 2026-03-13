/**
 * Footer for the run history list showing aggregate totals.
 */

import { HStack, Text } from "@chakra-ui/react";
import type { RunHistoryTotals } from "./run-history-transforms";

interface RunHistoryFooterProps {
  totals: RunHistoryTotals;
}

export function RunHistoryFooter({ totals }: RunHistoryFooterProps) {
  const { runCount, passedCount, failedCount, pendingCount } = totals;

  if (runCount === 0) return null;

  return (
    <HStack
      paddingX={6}
      paddingY={3}
      borderTopWidth={1}
      borderColor="border.emphasized"
      fontSize="xs"
      color="fg.muted"
      gap={4}
    >
      <Text>{runCount} runs</Text>
      {passedCount > 0 && <Text color="green.600">{passedCount} passed</Text>}
      {failedCount > 0 && <Text color="red.600">{failedCount} failed</Text>}
      {pendingCount > 0 && <Text color="yellow.600">{pendingCount} pending</Text>}
    </HStack>
  );
}
