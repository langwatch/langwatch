import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { dash } from "../dashPlaceholder";
import type { CellDef } from "../../types";

export const RootSpanNameCell = {
  id: "root-span-name",
  label: "Root span name",
  render: ({ row }) => (
    <Text
      textStyle="sm"
      color={row.name ? "fg" : "fg.subtle"}
      fontWeight="500"
      truncate
    >
      {row.name || dash}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;
