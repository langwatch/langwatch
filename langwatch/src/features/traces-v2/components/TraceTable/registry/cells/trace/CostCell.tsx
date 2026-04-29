import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { formatCost } from "../../../../../utils/formatters";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";

export const CostCell = {
  id: "cost",
  label: "Cost",
  render: ({ row }) => (
    <MonoCell>{formatCost(row.totalCost, row.tokensEstimated)}</MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right">
      {formatCost(row.totalCost, row.tokensEstimated)}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;
