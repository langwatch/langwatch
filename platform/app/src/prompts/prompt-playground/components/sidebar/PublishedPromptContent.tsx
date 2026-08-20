import { Box, HStack, Text } from "@chakra-ui/react";
import { OrganizationBadge } from "~/prompts/components/ui/OrganizationBadge";
import { getDisplayHandle } from "~/prompts/utils/promptHandle";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import { PublishedPromptActions } from "./PublishedPromptActions";

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
      {prompt?.scope === "ORGANIZATION" && (
        <Box marginLeft="-12px">
          <OrganizationBadge />
        </Box>
      )}
      {/* The rail is narrow and a handle can be long, so a truncated row keeps
          its full handle — folder included — on hover. Same affordance the
          prompt tabs use for the same reason. */}
      <Text
        overflow="hidden"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
        fontSize="sm"
        fontWeight="inherit"
        flex={1}
        minWidth={0}
        title={promptHandle ?? undefined}
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
