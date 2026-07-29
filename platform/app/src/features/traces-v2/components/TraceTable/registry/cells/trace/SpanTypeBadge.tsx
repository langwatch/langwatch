import { Text, type TextProps } from "@chakra-ui/react";
import type React from "react";

const PROMINENT_SPAN_TYPES = new Set(["llm", "agent", "workflow"]);

const PALETTE_BY_TYPE: Record<string, string> = {
  llm: "blue",
  agent: "purple",
  workflow: "teal",
  span: "gray",
};

function displaySpanType(spanType: string): string {
  return PROMINENT_SPAN_TYPES.has(spanType) ? spanType : "span";
}

/**
 * Span-type chip used in trace-row summaries. Uses Chakra's
 * `colorPalette` token scope (`colorPalette.subtle` / `.emphasized`)
 * instead of hardcoding `blue.subtle` / `blue.emphasized`, because the
 * hardcoded form rendered the LLM icon as near-invisible on the dark
 * theme (dark blue text on dark blue bg). The palette scope picks the
 * right light/dark pair automatically.
 */
export const SpanTypeBadge: React.FC<
  { spanType: string } & Omit<TextProps, "children">
> = ({ spanType, ...rest }) => {
  const display = displaySpanType(spanType);
  const palette = PALETTE_BY_TYPE[display] ?? "gray";
  return (
    <Text
      textStyle="2xs"
      fontWeight="semibold"
      colorPalette={palette}
      color="colorPalette.emphasized"
      background="colorPalette.subtle"
      paddingX={1.5}
      borderRadius="sm"
      lineHeight="tall"
      {...rest}
    >
      {display.toUpperCase()}
    </Text>
  );
};
