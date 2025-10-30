import { Text, HStack } from "@chakra-ui/react";
import { getDisplayHandle } from "./PublishedPromptsList";
import { PublishedPromptActions } from "./PublishedPromptActions";

interface PublishedPromptContentProps {
  promptId: string;
  promptHandle: string | null;
}

export function PublishedPromptContent({
  promptId,
  promptHandle,
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
      <PublishedPromptActions promptId={promptId} promptHandle={promptHandle} />
    </HStack>
  );
}
