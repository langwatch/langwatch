import { HStack, Text } from "@chakra-ui/react";
import { Keyboard } from "lucide-react";
import { Kbd } from "~/components/ops/shared/Kbd";

export function KeyboardHints() {
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
        <Kbd>←</Kbd>
        <Kbd>h</Kbd>
        <Text textStyle="xs" color="fg.muted">
          prev
        </Text>
      </HStack>
      <HStack gap={1}>
        <Kbd>→</Kbd>
        <Kbd>l</Kbd>
        <Text textStyle="xs" color="fg.muted">
          next
        </Text>
      </HStack>
      <HStack gap={1}>
        <Kbd>e</Kbd>
        <Text textStyle="xs" color="fg.muted">
          toggle event panel
        </Text>
      </HStack>
    </HStack>
  );
}
