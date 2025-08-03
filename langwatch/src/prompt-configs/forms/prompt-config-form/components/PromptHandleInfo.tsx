import { Box, HStack, Text } from "@chakra-ui/react";

import { type LlmConfigWithLatestVersion } from "~/server/prompt-config/repositories/llm-config.repository";

import { GeneratePromptApiSnippetDialog } from "../../../components/GeneratePromptApiSnippetDialog";
import { GenerateApiSnippetButton } from "../../../../components/GenerateApiSnippetButton";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { CopyButton } from "../../../../components/CopyButton";

interface ConfigHeaderProps {
  config: LlmConfigWithLatestVersion;
}

export function PromptHandleInfo({ config }: ConfigHeaderProps) {
  const { project } = useOrganizationTeamProject();

  return (
    <Box
      padding={2}
      borderRadius="md"
      borderWidth="1px"
      borderColor="gray.200"
      backgroundColor="gray.50"
      width="full"
    >
      <HStack justifyContent="space-between" width="full">
        <HStack paddingX={1} gap={1}>
          {config.handle ? (
            <Text fontSize="sm" fontWeight="500" fontFamily="mono">
              {config.handle}
            </Text>
          ) : (
            <Text color="gray.500">Draft</Text>
          )}
          {config.handle && (
            <CopyButton value={config.handle} label="Prompt ID" />
          )}
        </HStack>

        <HStack gap={2} alignSelf="flex-end">
          <GeneratePromptApiSnippetDialog
            configId={config.id}
            apiKey={project?.apiKey}
          >
            <GeneratePromptApiSnippetDialog.Trigger>
              <GenerateApiSnippetButton config={config} />
            </GeneratePromptApiSnippetDialog.Trigger>
          </GeneratePromptApiSnippetDialog>
        </HStack>
      </HStack>
    </Box>
  );
}
