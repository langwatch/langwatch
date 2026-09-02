import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../types/trace";
import { MonoCell } from "../../../../../../elements/explorer/trace-table/mono-cell";
import type { CellDef } from "../../types";

export const SpanCountCell = {
  id: "spans",
  label: "Spans",
  render: ({ row }) => <MonoCell>{row.spanCount.toLocaleString()}</MonoCell>,
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right">
      {row.spanCount.toLocaleString()}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;
