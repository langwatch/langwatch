import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";
import { LuPencil } from "react-icons/lu";

import { CopyButton } from "../../../../components/CopyButton";
import { GenerateApiSnippetButton } from "../../../../components/GenerateApiSnippetButton";
import { GeneratePromptApiSnippetDialog } from "../../../components/GeneratePromptApiSnippetDialog";
import type { PromptConfigFormValues } from "~/prompt-configs";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePromptConfigContext } from "~/prompt-configs/providers/PromptConfigProvider";
import {
  versionedPromptToPromptConfigFormValues,
} from "~/prompt-configs/llmPromptConfigUtils";
import { useCallback } from "react";
import { toaster } from "~/components/ui/toaster";

export function PromptHandleInfo({ configId }: { configId?: string }) {
  const { project } = useOrganizationTeamProject();
  const { apiKey } = project ?? {};
  const form = useFormContext<PromptConfigFormValues>();
  const { triggerChangeHandle } = usePromptConfigContext();

  /**
   * Trigger the change handle operation
   * for the given prompt id
   */
  const handleTriggerChangeHandle = useCallback(async (id: string) => {
    try {
      const prompt = await triggerChangeHandle({
        id,
      });
      toaster.create({
        title: "Prompt handle changed",
        description: `Prompt handle has been changed to ${prompt.handle}`,
        type: "success",
      });
      form.reset(versionedPromptToPromptConfigFormValues(prompt));
    } catch (error) {
      console.error(error);
      toaster.create({
        title: "Error changing prompt handle",
        description: "Failed to change prompt handle",
        type: "error",
      });
    }
  }, [triggerChangeHandle, form]);

  const handle = form.watch("handle");

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
          {handle ? (
            <Text fontSize="sm" fontWeight="500" fontFamily="mono">
              {handle}
            </Text>
          ) : (
            <Text color="gray.500">Draft</Text>
          )}
          {configId && handle && (
            <Button
              // Do not remove this id, it is used to trigger the edit dialog
              id="js-edit-prompt-handle"
              onClick={() => void handleTriggerChangeHandle(configId)}
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
          {handle && <CopyButton value={handle} label="Prompt ID" />}
          <GeneratePromptApiSnippetDialog configId={configId} apiKey={apiKey}>
            <GeneratePromptApiSnippetDialog.Trigger>
              <GenerateApiSnippetButton hasHandle={!!handle} />
            </GeneratePromptApiSnippetDialog.Trigger>
          </GeneratePromptApiSnippetDialog>
        </HStack>
      </HStack>
    </Box>
  );
}
