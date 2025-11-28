import { Text, HStack } from "@chakra-ui/react";
import { getDisplayHandle } from "./PublishedPromptsList";
import { PublishedPromptActions } from "./PublishedPromptActions";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";

interface PublishedPromptContentProps {
  promptId: string;
  promptHandle: string | null;
  prompt?: VersionedPrompt | null;
}

/**
 * Renders a published prompt list item with handle and actions.
 * Single Responsibility: Displays a single published prompt's handle and action menu in the sidebar.
 */
export function PublishedPromptContent({
  promptId,
  promptHandle,
  prompt,
}: PublishedPromptContentProps) {
  return (
    <HStack justify="space-between" width="full" className="group">
      <Text
        overflow="hidden"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
        fontSize="sm"
        fontWeight="normal"
        flex={1}
      >
        {getDisplayHandle(promptHandle)}
      </Text>
      <PublishedPromptActions
        promptId={promptId}
        promptHandle={promptHandle}
        prompt={prompt}
      />
    </HStack>
  );
}
