import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import type { CellDef } from "../../types";

export const TraceIdCell = {
  id: "trace-id",
  label: "Trace ID",
  render: ({ row }) => (
    <Text
      fontFamily="mono"
      textStyle="xs"
      color="fg.subtle"
      truncate
      userSelect="all"
    >
      {row.traceId}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;
