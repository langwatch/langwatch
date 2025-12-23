import { Box, HStack } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { PromptConfigFormValues } from "~/prompts";
import { GenerateApiSnippetButton } from "../../../../components/GenerateApiSnippetButton";
import { GeneratePromptApiSnippetDialog } from "../../../components/GeneratePromptApiSnippetDialog";
import { EditablePromptHandleField } from "../../fields/EditablePromptHandleField";

export function PromptHandleInfo() {
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
          <GeneratePromptApiSnippetDialog promptHandle={handle} apiKey={apiKey}>
            <GeneratePromptApiSnippetDialog.Trigger>
              <GenerateApiSnippetButton hasHandle={!!handle} />
            </GeneratePromptApiSnippetDialog.Trigger>
          </GeneratePromptApiSnippetDialog>
        </HStack>
      </HStack>
    </Box>
  );
}
