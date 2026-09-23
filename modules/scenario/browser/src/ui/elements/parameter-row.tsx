import { HStack, Text } from "@chakra-ui/react";

/**
 * What a secret parameter shows in place of a value. There is no value to
 * show: the run records the name and nothing else.
 */
const SECRET_VALUE_MASK = "••••••••";
export { SECRET_VALUE_MASK };

/** One name and what the run recorded for it. */
export function ParameterRow({
  name,
  value,
  muted = false,
}: {
  name: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <HStack gap={3} align="start">
      <Text fontSize="xs" fontFamily="mono" color="fg.muted" width="180px" flexShrink={0}>
        {name}
      </Text>
      <Text
        fontSize="xs"
        fontFamily="mono"
        wordBreak="break-word"
        color={muted ? "fg.subtle" : undefined}
      >
        {value}
      </Text>
    </HStack>
  );
}
