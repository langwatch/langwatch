import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { SPAN_TYPE_BADGE_STYLES } from "../../../../../utils/formatters";
import type { CellDef } from "../../types";

const PROMINENT_SPAN_TYPES = new Set(["llm", "agent", "workflow"]);

export const SpanTypeCell: CellDef<TraceListItem> = {
  id: "span-type",
  label: "Type",
  render: ({ row }) => {
    const spanType = row.rootSpanType;
    if (!spanType) {
      return (
        <Text textStyle="sm" color="fg.subtle">
          —
        </Text>
      );
    }
    const displayType = PROMINENT_SPAN_TYPES.has(spanType) ? spanType : "span";
    const badgeStyle = SPAN_TYPE_BADGE_STYLES[displayType];
    return (
      <Text
        textStyle="2xs"
        fontWeight="semibold"
        color={badgeStyle?.color ?? "gray.fg"}
        background={badgeStyle?.bg ?? "gray.subtle"}
        paddingX={1.5}
        paddingY={0.5}
        borderRadius="sm"
        display="inline-block"
        lineHeight="tall"
      >
        {displayType.toUpperCase()}
      </Text>
    );
  },
};
