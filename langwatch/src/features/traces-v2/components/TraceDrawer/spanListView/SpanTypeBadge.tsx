import { Box, Text } from "@chakra-ui/react";
import { SPAN_TYPE_COLORS } from "../../../utils/formatters";

export function SpanTypeBadge({ type }: { type: string }) {
  const color = (SPAN_TYPE_COLORS[type] as string) ?? "gray.solid";
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
      <Text textStyle="xs" fontWeight="semibold" color={color} lineHeight={1}>
        {label}
      </Text>
    </Box>
  );
}
