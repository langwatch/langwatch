import { Box, Text } from "@chakra-ui/react";

const SPAN_TYPE_PALETTE: Record<string, string> = {
  llm: "blue",
  tool: "green",
  agent: "purple",
  rag: "teal",
  guardrail: "orange",
  evaluation: "pink",
  chain: "cyan",
  span: "gray",
  module: "gray",
};

export function SpanTypeBadge({ type }: { type: string }) {
  const palette = SPAN_TYPE_PALETTE[type] ?? "gray";
  const label =
    type.length <= 5 ? type.toUpperCase() : type.slice(0, 5).toUpperCase();

  return (
    <Box
      display="inline-flex"
      alignItems="center"
      bg="bg.muted"
      borderRadius="sm"
      paddingX={1.5}
      paddingY={0.5}
      borderWidth="1px"
      borderColor="border.subtle"
    >
      <Text
        textStyle="xs"
        fontWeight="semibold"
        color={`${palette}.fg`}
        lineHeight={1}
      >
        {label}
      </Text>
    </Box>
  );
}
