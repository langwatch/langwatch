import { Box, HStack, Text, VStack, Tag } from "@chakra-ui/react";

import { type LlmConfigWithLatestVersion } from "~/server/prompt-config/repositories/llm-config.repository";

import { VersionHistoryButton } from "./VersionHistoryButton";
import { VersionSaveButton } from "./VersionSaveButton";

interface ConfigHeaderProps {
  config: LlmConfigWithLatestVersion;
  saveEnabled?: boolean;
  onSaveClick: () => void;
  isSaving?: boolean;
}

export function PromptConfigInfoBox({
  config,
  saveEnabled,
  onSaveClick,
  isSaving,
}: ConfigHeaderProps) {
  const { latestVersion } = config;
  const { version, commitMessage } = latestVersion;

  return (
    <Box
      padding={4}
      borderRadius="md"
      borderWidth="1px"
      borderColor="gray.200"
      backgroundColor="gray.50"
      width="full"
    >
      <VStack gap={4} width="full">
        <HStack justifyContent="space-between" width="full">
          <VStack align="start" gap={1}>
            <HStack>
              <Text fontSize="md" fontWeight="medium">
                {commitMessage || "No commit message"}
              </Text>
              <Tag.Root size="md" colorScheme="orange" fontWeight="bold">
                <Tag.Label>v{version}</Tag.Label>
              </Tag.Root>
            </HStack>
          </VStack>

          <VStack align="start" gap={1} flex={1} maxWidth="60%"></VStack>

          <HStack gap={2} alignSelf="flex-end">
            <VersionHistoryButton configId={config.id} />
            <VersionSaveButton
              saveEnabled={saveEnabled}
              onSaveClick={onSaveClick}
              isSaving={isSaving}
            />
          </HStack>
        </HStack>
      </VStack>
    </Box>
  );
}
