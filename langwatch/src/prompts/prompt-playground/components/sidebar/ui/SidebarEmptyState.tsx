import { Text } from "@chakra-ui/react";

/**
 * Empty state component for the sidebar when no prompts exist.
 * Single Responsibility: Display a friendly message when the prompts list is empty.
 */
export function SidebarEmptyState() {
  return (
    <Text
      fontSize="sm"
      color="gray.500"
      textAlign="center"
      paddingY={6}
      paddingX={4}
    >
      No prompts yet
    </Text>
  );
}
