import { Box, Circle, HStack, Text, VStack } from "@chakra-ui/react";
import { LuCopy } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import { OrganizationBadge } from "~/prompts/components/ui/OrganizationBadge";
import { getDisplayHandle } from "~/prompts/utils/promptHandle";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import { PublishedPromptActions } from "./PublishedPromptActions";

interface PublishedPromptContentProps {
  promptId: string;
  promptHandle: string | null;
  prompt?: VersionedPrompt | null;
}

/** A one-line rail row whose detail is available without making the rail wider. */
export function PublishedPromptContent({
  promptId,
  promptHandle,
  prompt,
}: PublishedPromptContentProps) {
  const author =
    prompt?.author?.name?.trim() ||
    prompt?.author?.email?.trim() ||
    "Unknown author";
  const liveTags =
    prompt?.tags
      .filter(({ name }) => name !== "latest")
      .map(({ name }) => name) ?? [];

  return (
    <HStack justify="space-between" width="full" className="group">
      {prompt?.scope === "ORGANIZATION" && (
        <Box marginLeft="-12px">
          <OrganizationBadge />
        </Box>
      )}
      <Tooltip
        content={
          <VStack align="flex-start" gap={0.5}>
            <Text fontWeight="semibold">{promptHandle}</Text>
            <Text>
              v{prompt?.version ?? 0} · {prompt?.model}
            </Text>
            <Text>Last changed by {author}</Text>
            {liveTags.length > 0 && <Text>Live as {liveTags.join(", ")}</Text>}
            {prompt?.copiedFromPromptId && (
              <Text>Replicated from another prompt</Text>
            )}
          </VStack>
        }
        positioning={{ placement: "right" }}
        openDelay={500}
      >
        <HStack flex={1} minWidth={0} gap={1.5}>
          <Text
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            fontSize="sm"
            fontWeight="inherit"
            flex={1}
            minWidth={0}
          >
            {getDisplayHandle(promptHandle)}
          </Text>
          {liveTags.length > 0 && (
            <Circle
              size="6px"
              background="green.solid"
              aria-label={`Live as ${liveTags.join(", ")}`}
              flexShrink={0}
            />
          )}
          {prompt?.copiedFromPromptId && (
            <Box
              color="fg.subtle"
              flexShrink={0}
              aria-label="Replicated prompt"
            >
              <LuCopy size={11} />
            </Box>
          )}
          {prompt?.version != null && (
            <Text textStyle="2xs" color="fg.subtle" flexShrink={0}>
              v{prompt.version}
            </Text>
          )}
        </HStack>
      </Tooltip>
      <PublishedPromptActions
        promptId={promptId}
        promptHandle={promptHandle}
        prompt={prompt}
      />
    </HStack>
  );
}
