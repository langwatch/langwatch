import { Box, Button, HStack, Text, useDisclosure } from "@chakra-ui/react";
import { useCallback } from "react";
import { useFormContext } from "react-hook-form";
import { LuPencil } from "react-icons/lu";

import { CopyButton } from "../../../../components/CopyButton";
import { GenerateApiSnippetButton } from "../../../../components/GenerateApiSnippetButton";
import { GeneratePromptApiSnippetDialog } from "../../../components/GeneratePromptApiSnippetDialog";
import { ChangeHandleDialog } from "../../../forms/ChangeHandleDialog";
import { type ChangeHandleFormValues } from "../../../forms/schemas/change-handle-form.schema";
import type { PromptConfigFormValues } from "~/prompt-configs";

import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";



export function PromptHandleInfo({ configId }: { configId: string }) {
  const { project } = useOrganizationTeamProject();
  const { open, onOpen, onClose } = useDisclosure();
  const form = useFormContext<PromptConfigFormValues>();

  const handle = form.watch("handle");
  const scope = form.watch("scope");

  const handleChangeHandleSubmit = useCallback(
    async (data: ChangeHandleFormValues) => {
      try {

      await Promise.all([
        form.setValue("handle", data.handle),
        form.setValue("scope", data.scope),
      ]);
      } catch (error) {
        toaster.create({
          title: "Error",
          description: "Failed to change handle",
          type: "error",
        });
      }
    },
    [form]
  );

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
          {handle && (
            <Button
              // Do not remove this id, it is used to trigger the edit dialog
              id="js-edit-prompt-handle"
              onClick={onOpen}
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
          {handle && (
            <CopyButton value={handle} label="Prompt ID" />
          )}
          <GeneratePromptApiSnippetDialog
            configId={configId}
            apiKey={project?.apiKey}
          >
            <GeneratePromptApiSnippetDialog.Trigger>
              <GenerateApiSnippetButton hasHandle={!!handle} />
            </GeneratePromptApiSnippetDialog.Trigger>
          </GeneratePromptApiSnippetDialog>
        </HStack>
      </HStack>
      <ChangeHandleDialog
        currentHandle={handle}
        currentScope={scope}
        isOpen={open}
        onClose={onClose}
        onSubmit={handleChangeHandleSubmit}
      />
    </Box>
  );
}
