import { HStack, Text } from "@chakra-ui/react";

interface CommandBarFooterProps {
  isMac: boolean;
}

/**
 * Footer component showing keyboard shortcuts.
 */
export function CommandBarFooter({ isMac }: CommandBarFooterProps) {
  return (
    <HStack
      borderTop="1px solid"
      borderColor="border.muted"
      px={4}
      py={2.5}
      gap={5}
      fontSize="12px"
      color="fg.muted"
    >
      <HStack gap={1}>
        <Text opacity={0.5}>{isMac ? "⌘" : "Ctrl"}↵</Text>
        <Text>Open in new tab</Text>
      </HStack>
      <HStack gap={1}>
        <Text opacity={0.5}>{isMac ? "⌘" : "Ctrl"}L</Text>
        <Text>Copy link</Text>
      </HStack>
      <HStack gap={1}>
        <Text opacity={0.5}>↑↓</Text>
        <Text>Navigate</Text>
      </HStack>
      <HStack gap={1}>
        <Text opacity={0.5}>esc</Text>
        <Text>Close</Text>
      </HStack>
    </HStack>
  );
}
