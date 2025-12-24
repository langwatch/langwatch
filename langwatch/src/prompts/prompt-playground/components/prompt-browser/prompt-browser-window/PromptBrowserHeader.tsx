import { HStack, Spacer } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";
import { GenerateApiSnippetButton } from "~/components/GenerateApiSnippetButton";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { PromptConfigFormValues } from "~/prompts";
import { GeneratePromptApiSnippetDialog } from "~/prompts/components/GeneratePromptApiSnippetDialog";
import { ModelSelectFieldMini } from "~/prompts/forms/fields/ModelSelectFieldMini";
import { VersionHistoryButton } from "~/prompts/forms/prompt-config-form/components/VersionHistoryButton";
import { versionedPromptToPromptConfigFormValuesWithSystemMessage } from "~/prompts/utils/llmPromptConfigUtils";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import { SavePromptButton } from "./SavePromptButton";

/**
 * Header bar for the prompt browser with handle, model selector, and action buttons.
 * Single Responsibility: Renders the top control bar for editing and managing prompt configurations.
 */
export function PromptBrowserHeader() {
  const { project } = useOrganizationTeamProject();
  const formMethods = useFormContext<PromptConfigFormValues>();
  const handle = formMethods.watch("handle");
  const configId = formMethods.watch("configId");

  /**
   * handleOnRestore
   * Single Responsibility: Restores form values when a version is selected from history.
   * @param params - The versioned prompt data to restore
   */
  const handleOnRestore = async (params: VersionedPrompt) => {
    const newFormValues =
      versionedPromptToPromptConfigFormValuesWithSystemMessage(params);
    formMethods.reset(newFormValues);
  };

  return (
    <HStack width="full" bg="white" display="flex" flexDirection="row">
      <HStack>
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
        <GeneratePromptApiSnippetDialog
          promptHandle={handle}
          apiKey={project?.apiKey}
        >
          <GeneratePromptApiSnippetDialog.Trigger>
            <GenerateApiSnippetButton hasHandle={!!handle} />
          </GeneratePromptApiSnippetDialog.Trigger>
        </GeneratePromptApiSnippetDialog>
        <SavePromptButton />
      </HStack>
    </HStack>
  );
}
