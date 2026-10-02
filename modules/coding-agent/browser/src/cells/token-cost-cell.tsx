import { formatCost } from "@langwatch/design-system/display-formatters";
import { Text, VStack } from "@langwatch/design-system/primitives";
import type React from "react";

import type { SessionListRow } from "../session-list-row.ts";
import { MissingValue } from "../ui/elements/cells/missing-value.tsx";
import { ComparisonBar } from "./comparison-bar.tsx";

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
