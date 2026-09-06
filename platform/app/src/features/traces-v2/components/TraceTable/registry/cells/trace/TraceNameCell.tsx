import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import type { CellDef } from "../../types";
import { dash } from "../dashPlaceholder";

export const TraceNameCell = {
  id: "trace-name",
  label: "Trace name",
  render: ({ row }) => (
    <Text
      textStyle="sm"
      color={row.traceName ? "fg" : "fg.subtle"}
      fontWeight="500"
      truncate
    >
      {row.traceName || dash}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;
