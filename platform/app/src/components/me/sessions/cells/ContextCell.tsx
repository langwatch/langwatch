import { Text, VStack } from "@chakra-ui/react";
import {
  ComparisonBar,
  MissingValue,
  type SessionListRow,
} from "@langwatch/coding-agent-web";
import type React from "react";

import { Tooltip } from "@langwatch/design-system/tooltip";
import { formatTokens } from "~/features/traces-v2/utils/formatters";

/**
 * The two token figures that answer different questions, and a bar comparing
 * the first against the heaviest session on the page.
 *
 * The total is what the session consumed over its whole life, and it leads:
 * it is what the column sorts by, and it is the number that keeps growing, so
 * it is the one worth ranking. Peak context, how much the session was carrying
 * when it was heaviest, sits under it: it decides whether a session was about
 * to compact, but it saturates against the context window rather than ranking.
 * The bar compares the total against the heaviest session on the page.
 */
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
