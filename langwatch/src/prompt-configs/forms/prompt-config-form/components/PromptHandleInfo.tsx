import { Box, Button, HStack, Text } from "@chakra-ui/react";

import { type LlmConfigWithLatestVersion } from "~/server/prompt-config/repositories/llm-config.repository";

import { GeneratePromptApiSnippetDialog } from "../../../components/GeneratePromptApiSnippetDialog";
import { GenerateApiSnippetButton } from "../../../../components/GenerateApiSnippetButton";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { CopyButton } from "../../../../components/CopyButton";
import { usePromptConfigContext } from "../../../providers/PromptConfigProvider";
import { useCallback } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { PromptConfigFormValues } from "../../../hooks/usePromptConfigForm";
import { LuPencil } from "react-icons/lu";

interface ConfigHeaderProps {
  config: LlmConfigWithLatestVersion;
  methods: UseFormReturn<PromptConfigFormValues>;
}

export function PromptHandleInfo({ methods, config }: ConfigHeaderProps) {
  const { project } = useOrganizationTeamProject();
  const { triggerSaveVersion } = usePromptConfigContext();

  const handleEditClick = useCallback(() => {
    void triggerSaveVersion({
      config,
      updateConfigValues: methods.getValues(),
      editingHandleOrScope: true,
    });
  }, [config, methods, triggerSaveVersion]);

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
        <HStack paddingX={1} gap={1} className="group">
          {config.handle ? (
            <Text fontSize="sm" fontWeight="500" fontFamily="mono">
              {config.handle}
            </Text>
          ) : (
            <Text color="gray.500">Draft</Text>
          )}
          {config.handle && (
            <Button
              // Do not remove this id, it is used to trigger the edit dialog
              id="js-edit-prompt-handle"
              onClick={handleEditClick}
              variant="ghost"
              _hover={{
                backgroundColor: "gray.100",
              }}
              textTransform="uppercase"
              visibility="hidden"
              _groupHover={{
                visibility: "visible",
              }}
            >
              <LuPencil />
            </Button>
          )}
        </HStack>

        <HStack gap={2} alignSelf="flex-end">
          {config.handle && (
            <CopyButton value={config.handle} label="Prompt ID" />
          )}
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
