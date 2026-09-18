import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../types/trace.ts";
import type { CellDef } from "../../types.ts";
import { SpanTypeBadge } from "../../../../../../elements/explorer/trace-table/registry/cells/trace/span-type-badge.tsx";

export const RootSpanTypeCell = {
  id: "root-span-type",
  label: "Root span type",
  render: ({ row }) => {
    const spanType = row.rootSpanType;
    if (!spanType) {
      return (
        <Text textStyle="sm" color="fg.subtle">
          —
        </Text>
      );
    }
    return <SpanTypeBadge spanType={spanType} display="inline-block" paddingY={0.5} />;
  },
} as const satisfies CellDef<TraceListItem>;
