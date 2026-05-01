import { HStack, Text } from "@chakra-ui/react";

export function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <HStack justify="space-between" gap={4} align="flex-start" minWidth={0}>
      <Text textStyle="xs" color="fg.muted" flexShrink={0}>
        {label}
      </Text>
      <Text
        textStyle="xs"
        fontFamily="mono"
        color="fg"
        textAlign="right"
        // Long values (conversation IDs, scenario run IDs) need to wrap
        // inside the tooltip box rather than spilling out of it.
        wordBreak="break-all"
        whiteSpace="nowrap"
        textOverflow="ellipsis"
        overflow="hidden"
        // minWidth={0}
      >
        {value}
      </Text>
    </HStack>
  );
}
