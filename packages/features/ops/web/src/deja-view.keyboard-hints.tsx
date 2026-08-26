import { HStack, Text } from "@chakra-ui/react";
import { Keyboard } from "lucide-react";
import type { ReactNode } from "react";

export function DejaViewKeyboardHints({
  renderKey,
}: {
  renderKey: (label: string) => ReactNode;
}) {
  return (
    <HStack
      paddingX={4}
      paddingY={1}
      bg="bg.subtle"
      borderTop="1px solid"
      borderTopColor="border"
      gap={4}
      flexShrink={0}
    >
      <HStack gap={1}>
        <Keyboard size={10} />
        <Text textStyle="xs" color="fg.muted">
          Navigation:
        </Text>
      </HStack>
      <HStack gap={1}>
        {renderKey("←")}
        {renderKey("h")}
        <Text textStyle="xs" color="fg.muted">
          prev
        </Text>
      </HStack>
      <HStack gap={1}>
        {renderKey("→")}
        {renderKey("l")}
        <Text textStyle="xs" color="fg.muted">
          next
        </Text>
      </HStack>
      <HStack gap={1}>
        {renderKey("e")}
        <Text textStyle="xs" color="fg.muted">
          toggle event panel
        </Text>
      </HStack>
    </HStack>
  );
}
