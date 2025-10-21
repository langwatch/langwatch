import { HStack, Spacer } from "@chakra-ui/react";
import { EditablePromptHandleField } from "~/prompt-configs/forms/fields/EditablePromptHandleField";
import { GeneratePromptApiSnippetDialog } from "~/prompt-configs/components/GeneratePromptApiSnippetDialog";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { GenerateApiSnippetButton } from "~/components/GenerateApiSnippetButton";
import { useFormContext } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompt-configs";
import { ModelSelectFieldMini } from "~/prompt-configs/forms/fields/ModelSelectFieldMini";
import { SavePromptButton } from "./SavePromptButton";
import { VersionHistoryButton } from "~/prompt-configs/forms/prompt-config-form/components/VersionHistoryButton";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import { versionedPromptToPromptConfigFormValuesWithSystemMessage } from "~/prompt-configs/utils/llmPromptConfigUtils";

export function PromptBrowserHeader() {
  const { project } = useOrganizationTeamProject();
  const formMethods = useFormContext<PromptConfigFormValues>();
  const handle = formMethods.watch("handle");
  const configId = formMethods.watch("configId");

  const handleOnRestore = async (params: VersionedPrompt) => {
    const newFormValues =
      versionedPromptToPromptConfigFormValuesWithSystemMessage(params);
    formMethods.reset(newFormValues);
  };

  return (
    <HStack width="full" bg="white">
      <HStack>
        <EditablePromptHandleField width="auto" />
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
      <Spacer />
      <HStack>
        {configId && (
          <VersionHistoryButton
            configId={configId}
            onRestoreSuccess={(params) => handleOnRestore(params)}
          />
        )}
        <SavePromptButton />
      </HStack>
    </HStack>
  );
}
