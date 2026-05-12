import { Text, type TextProps } from "@chakra-ui/react";
import type React from "react";
import { SPAN_TYPE_BADGE_STYLES } from "../../../../../utils/formatters";

const PROMINENT_SPAN_TYPES = new Set(["llm", "agent", "workflow"]);

function displaySpanType(spanType: string): string {
  return PROMINENT_SPAN_TYPES.has(spanType) ? spanType : "span";
}

export const SpanTypeBadge: React.FC<
  { spanType: string } & Omit<TextProps, "children">
> = ({ spanType, ...rest }) => {
  const display = displaySpanType(spanType);
  const badgeStyle = SPAN_TYPE_BADGE_STYLES[display];
  return (
    <Text
      textStyle="2xs"
      fontWeight="semibold"
      color={badgeStyle?.color ?? "gray.fg"}
      background={badgeStyle?.bg ?? "gray.subtle"}
      paddingX={1.5}
      borderRadius="sm"
      lineHeight="tall"
      {...rest}
    >
      {display.toUpperCase()}
    </Text>
  );
};
