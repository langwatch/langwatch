import { Text, VStack } from "@chakra-ui/react";
import type React from "react";

import { formatCost } from "@langwatch/design-system/display-formatters";
import type { SessionListRow } from "../session-list-row";
import { ComparisonBar } from "./comparison-bar";
import { MissingValue } from "./missing-value";

/** What the session's tokens cost, against the dearest one on the page. */
export const TokenCostCell: React.FC<{
  row: SessionListRow;
  largestCost: number;
}> = ({ row, largestCost }) => {
  if (row.costUsd === null) {
    return <MissingValue />;
  }

  return (
    <VStack align="stretch" gap={1}>
      <Text fontSize="sm" textAlign="end">
        {formatCost(row.costUsd)}
      </Text>
      <ComparisonBar value={row.costUsd} largest={largestCost} />
    </VStack>
  );
};
