import type { WireVersionedPrompt } from "../../../model/wire-versioned-prompt.ts";
import { Box, HStack, Text } from "@chakra-ui/react";
import { getDisplayHandle, OrganizationBadge } from "../../../surfaces/prompt-reference/index.ts";
import { PublishedPromptActions } from "./published-prompt-actions.tsx";

interface PublishedPromptContentProps {
  promptId: string;
  promptHandle: string | null;
  prompt?: WireVersionedPrompt | null;
}

/**
 * Renders a published prompt list item with handle and actions.
 * Single Responsibility: display a published prompt's handle and action menu in the sidebar.
 */
export function PublishedPromptContent({
  promptId,
  promptHandle,
  prompt,
}: PublishedPromptContentProps) {
  return (
    <HStack justify="space-between" width="full" className="group">
      {prompt?.scope === "ORGANIZATION" && (
        <Box marginLeft="-12px">
          <OrganizationBadge />
        </Box>
      )}
      <Text
        overflow="hidden"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
        fontSize="12.5px"
        fontWeight="normal"
        flex={1}
      >
        {getDisplayHandle(promptHandle)}
      </Text>
      <PublishedPromptActions promptId={promptId} promptHandle={promptHandle} prompt={prompt} />
    </HStack>
  );
}
