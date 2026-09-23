import { Text, VStack } from "@chakra-ui/react";
import { MissingValue } from "@langwatch/coding-agent-browser-kit";
import { formatTokens } from "@langwatch/design-system/display-formatters";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type React from "react";

import type { SessionListRow } from "../session-list-row.ts";
import { ComparisonBar } from "./comparison-bar.tsx";

// Total tokens (sorts column) with bar comparing to heaviest session; peak
// context shows but doesn't sort (saturates at context window).
export const ContextCell: React.FC<{
  row: SessionListRow;
  largestTotal: number;
}> = ({ row, largestTotal }) => {
  if (row.peakContextTokens === 0 && row.totalTokens === 0) {
    return <MissingValue />;
  }

  return (
    <Tooltip
      content="Total is every token the session consumed. Peak is the largest context carried into a single model call."
      positioning={{ placement: "left" }}
    >
      <VStack align="stretch" gap={1} cursor="help" tabIndex={0}>
        <VStack align="end" gap={0}>
          <Text fontSize="sm">Total {formatTokens(row.totalTokens)}</Text>
          <Text fontSize="xs" color="fg.muted">
            Peak {formatTokens(row.peakContextTokens)}
          </Text>
        </VStack>
        <ComparisonBar value={row.totalTokens} largest={largestTotal} />
      </VStack>
    </Tooltip>
  );
};
