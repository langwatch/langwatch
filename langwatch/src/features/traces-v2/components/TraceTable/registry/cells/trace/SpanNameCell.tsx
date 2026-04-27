import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import type { CellDef } from "../../types";

export const SpanNameCell: CellDef<TraceListItem> = {
  id: "span-name",
  label: "Name",
  render: ({ row }) => (
    <Text textStyle="sm" color="fg" fontWeight="500" truncate>
      {row.rootSpanName ?? row.name ?? "—"}
    </Text>
  ),
};
