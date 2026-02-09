/**
 * Footer for run history list showing aggregate totals.
 *
 * Displays: "X runs" + "Y passed" + "Z failed"
 */

import { HStack, Text } from "@chakra-ui/react";
import type { RunHistoryTotals } from "./run-history-transforms";

type RunHistoryFooterProps = {
  totals: RunHistoryTotals;
};

export function RunHistoryFooter({ totals }: RunHistoryFooterProps) {
  return (
    <HStack
      justify="space-between"
      paddingX={4}
      paddingY={3}
      borderTop="1px solid"
      borderColor="border"
    >
      <Text fontSize="sm" color="fg.muted">
        {totals.runCount} {totals.runCount === 1 ? "run" : "runs"}
      </Text>
      <HStack gap={4}>
        <Text fontSize="sm" color="green.600">
          {totals.passedCount} passed
        </Text>
        <Text fontSize="sm" color="red.600">
          {totals.failedCount} failed
        </Text>
      </HStack>
    </HStack>
  );
}
