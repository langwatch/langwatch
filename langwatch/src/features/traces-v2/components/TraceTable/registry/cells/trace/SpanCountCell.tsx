import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";

export const SpanCountCell: CellDef<TraceListItem> = {
  id: "spans",
  label: "Spans",
  render: ({ row }) => <MonoCell>{row.spanCount.toLocaleString()}</MonoCell>,
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right">
      {row.spanCount.toLocaleString()}
    </Text>
  ),
};
