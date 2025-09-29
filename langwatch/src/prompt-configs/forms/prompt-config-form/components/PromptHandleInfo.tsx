import { Box, HStack } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";

import { GeneratePromptApiSnippetDialog } from "../../../components/GeneratePromptApiSnippetDialog";
import type { PromptConfigFormValues } from "~/prompt-configs";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { EditablePromptHandleField } from "../../fields/EditablePromptHandleField";

export function PromptHandleInfo({ configId }: { configId?: string }) {
  const { project } = useOrganizationTeamProject();
  const { apiKey } = project ?? {};
  const form = useFormContext<PromptConfigFormValues>();
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
        <EditablePromptHandleField />
        <HStack gap={2} alignSelf="flex-end">
          <GeneratePromptApiSnippetDialog
            configId={configId}
            apiKey={apiKey}
            hasHandle={!!handle}
          />
        </HStack>
      </HStack>
    </Box>
  );
}
