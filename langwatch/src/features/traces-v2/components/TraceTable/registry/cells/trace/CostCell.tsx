import { Text } from "@chakra-ui/react";
import type { ReactElement } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import type { TraceListItem } from "../../../../../types/trace";
import { formatCost } from "../../../../../utils/formatters";
import { CostBreakdownTooltipContent } from "../../../../shared/CostBreakdownTooltip";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";

// `totalCost` is the grand list-price cost; `nonBilledCost` is the bundled
// (theoretical) portion a tool on a flat plan never pays per token. Show the
// billed amount so a bundled coding session doesn't read as real spend; the
// hover surfaces the billed / non-billed / theoretical split — the same
// breakdown the trace-details cost pill shows.
function billedCostOf(row: TraceListItem): number {
  return Math.max(0, row.totalCost - (row.nonBilledCost ?? 0));
}

function isBundled(row: TraceListItem): boolean {
  return (row.nonBilledCost ?? 0) > 0;
}

function BundledCostTooltip({
  row,
  children,
}: {
  row: TraceListItem;
  children: ReactElement;
}) {
  return (
    <Tooltip
      content={
        <CostBreakdownTooltipContent
          isBundled
          billedCost={billedCostOf(row)}
          nonBilledCost={row.nonBilledCost ?? 0}
          grandCost={row.totalCost}
          tokensEstimated={row.tokensEstimated}
        />
      }
      positioning={{ placement: "top" }}
    >
      {children}
    </Tooltip>
  );
}

export const CostCell = {
  id: "cost",
  label: "Cost",
  render: ({ row }) =>
    isBundled(row) ? (
      <BundledCostTooltip row={row}>
        <Text
          as="span"
          color="purple.fg"
          fontWeight="medium"
          whiteSpace="nowrap"
          textStyle="xs"
        >
          Bundled
        </Text>
      </BundledCostTooltip>
    ) : (
      <MonoCell>{formatCost(billedCostOf(row), row.tokensEstimated)}</MonoCell>
    ),
  renderComfortable: ({ row }) =>
    isBundled(row) ? (
      <BundledCostTooltip row={row}>
        <Text
          textStyle="sm"
          color="purple.fg"
          fontWeight="medium"
          textAlign="right"
        >
          Bundled
        </Text>
      </BundledCostTooltip>
    ) : (
      <Text textStyle="sm" color="fg.muted" textAlign="right">
        {formatCost(billedCostOf(row), row.tokensEstimated)}
      </Text>
    ),
} as const satisfies CellDef<TraceListItem>;
