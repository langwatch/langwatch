import { Box, Text, VStack } from "@chakra-ui/react";
import { LuSparkles } from "react-icons/lu";
import { AddPromptButton } from "../AddPromptButton";

/** Compact first-run guidance that still fits the rail's existing width. */
export function SidebarEmptyState() {
  return (
    <VStack
      align="center"
      gap={2.5}
      paddingX={4}
      paddingY={8}
      textAlign="center"
    >
      <Box
        display="grid"
        placeItems="center"
        width="30px"
        height="30px"
        borderRadius="lg"
        background="orange.subtle"
        color="orange.fg"
      >
        <LuSparkles size={15} />
      </Box>
      <VStack gap={0.5}>
        <Text fontSize="sm" fontWeight="semibold">
          Your prompt library starts here
        </Text>
        <Text fontSize="xs" color="fg.muted">
          Create a prompt, test it in a conversation, then save its first
          version.
        </Text>
      </VStack>
      <AddPromptButton size="xs" variant="outline" />
    </VStack>
  );
}
