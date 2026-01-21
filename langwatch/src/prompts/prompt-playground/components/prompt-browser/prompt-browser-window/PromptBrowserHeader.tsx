import { Box } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompts";
import { PromptEditorHeader } from "~/prompts/components/PromptEditorHeader";
import { useHandleSavePrompt } from "~/prompts/prompt-playground/hooks/useHandleSavePrompt";
import { useHasUnsavedChanges } from "~/prompts/prompt-playground/hooks/useHasUnsavedChanges";
import { versionedPromptToPromptConfigFormValuesWithSystemMessage } from "~/prompts/utils/llmPromptConfigUtils";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import { useTabId } from "../ui/TabContext";

/**
 * Header bar for the prompt browser with handle, model selector, and action buttons.
 * Single Responsibility: Renders the top control bar for editing and managing prompt configurations.
 *
 * Uses the shared PromptEditorHeader component for consistency with the drawer.
 */
export function PromptBrowserHeader() {
  const formMethods = useFormContext<PromptConfigFormValues>();
  const { handleSaveVersion } = useHandleSavePrompt();
  const tabId = useTabId();
  const hasUnsavedChanges = useHasUnsavedChanges(tabId);

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
    <Box width="full">
      <PromptEditorHeader
        onSave={handleSaveVersion}
        hasUnsavedChanges={hasUnsavedChanges}
        onVersionRestore={handleOnRestore}
      />
    </Box>
  );
}
