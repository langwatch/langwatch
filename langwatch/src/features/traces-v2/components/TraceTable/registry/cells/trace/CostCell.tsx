import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { formatCost } from "../../../../../utils/formatters";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";

// `totalCost` is the grand list-price cost; `nonBilledCost` is the bundled
// (theoretical) portion a tool on a flat plan never pays per token. Show the
// billed amount so a bundled coding session doesn't read as real spend; the
// hover title surfaces the split.
function billedCostOf(row: TraceListItem): number {
  return Math.max(0, row.totalCost - (row.nonBilledCost ?? 0));
}

function bundledTitle(row: TraceListItem): string | undefined {
  if ((row.nonBilledCost ?? 0) <= 0) return undefined;
  return `Bundled plan, not billed per token. Billed ${formatCost(
    billedCostOf(row),
  )}, theoretical ${formatCost(row.totalCost)}.`;
}

export const CostCell = {
  id: "cost",
  label: "Cost",
  render: ({ row }) => (
    <MonoCell title={bundledTitle(row)}>
      {formatCost(billedCostOf(row), row.tokensEstimated)}
    </MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text
      title={bundledTitle(row)}
      textStyle="sm"
      color="fg.muted"
      textAlign="right"
    >
      {formatCost(billedCostOf(row), row.tokensEstimated)}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;
