import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../types/trace.ts";
import type { CellDef } from "../../types.ts";
import { dash } from "../../../../../../elements/explorer/trace-table/registry/cells/dash-placeholder.tsx";

export const RootSpanNameCell = {
  id: "root-span-name",
  label: "Root span name",
  render: ({ row }) => (
    <Text textStyle="sm" color={row.name ? "fg" : "fg.subtle"} fontWeight="500" truncate>
      {row.name || dash}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;
