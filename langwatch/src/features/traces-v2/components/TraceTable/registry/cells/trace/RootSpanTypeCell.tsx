import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import type { CellDef } from "../../types";
import { SpanTypeBadge } from "./SpanTypeBadge";

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
    return (
      <SpanTypeBadge
        spanType={spanType}
        display="inline-block"
        paddingY={0.5}
      />
    );
  },
} as const satisfies CellDef<TraceListItem>;
