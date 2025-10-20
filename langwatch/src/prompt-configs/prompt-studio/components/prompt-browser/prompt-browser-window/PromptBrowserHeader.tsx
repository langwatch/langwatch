import { HStack } from "@chakra-ui/react";
import { EditablePromptHandleField } from "~/prompt-configs/forms/fields/EditablePromptHandleField";
import { GeneratePromptApiSnippetDialog } from "~/prompt-configs/components/GeneratePromptApiSnippetDialog";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { GenerateApiSnippetButton } from "~/components/GenerateApiSnippetButton";
import { useFormContext } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompt-configs";
import { ModelSelectFieldMini } from "~/prompt-configs/forms/fields/ModelSelectFieldMini";

export function PromptBrowserHeader() {
  const { project } = useOrganizationTeamProject();
  const formMethods = useFormContext<PromptConfigFormValues>();
  const handle = formMethods.watch("handle");

  return (
    <HStack width="full" bg="white">
      <EditablePromptHandleField />
      <GeneratePromptApiSnippetDialog
        promptHandle={handle}
        apiKey={project?.apiKey}
      >
        <GeneratePromptApiSnippetDialog.Trigger>
          <GenerateApiSnippetButton hasHandle={!!handle} />
        </GeneratePromptApiSnippetDialog.Trigger>
      </GeneratePromptApiSnippetDialog>
      <ModelSelectFieldMini />
    </HStack>
  );
}
