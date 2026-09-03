import { Box } from "@chakra-ui/react";
import { useTabId } from "../../studio-internals";
import { useFormContext } from "react-hook-form";
import {
  type PromptConfigFormValues,
  versionedPromptToPromptConfigFormValuesWithSystemMessage,
} from "../../../../surfaces/prompt-form";
import { PromptEditorHeader } from "../../prompt-editor-header";
import { useHandleSavePrompt } from "../../../../behavior/use-handle-save-prompt";
import { useHasUnsavedChanges } from "../../../../behavior/use-has-unsaved-changes";
import { useDraggableTabsBrowserStore } from "../../../../behavior/use-prompt-tabs-browser-store";
import type { VersionedPrompt } from "@langwatch/prompt-contract";

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
  const openHistoryOnLoad = useDraggableTabsBrowserStore(({ windows }) => {
    const tab = windows.flatMap((w) => w.tabs).find((t) => t.id === tabId);
    return tab?.data.meta.openHistoryOnLoad;
  });

  /**
   * handleOnRestore
   * Single Responsibility: Restores form values when a version is selected from history.
   * @param params - The versioned prompt data to restore
   */
  const handleOnRestore = async (params: VersionedPrompt) => {
    const newFormValues = versionedPromptToPromptConfigFormValuesWithSystemMessage(params);
    formMethods.reset(newFormValues);
  };

  return (
    <Box width="full">
      <PromptEditorHeader
        onSave={handleSaveVersion}
        hasUnsavedChanges={hasUnsavedChanges}
        onVersionRestore={handleOnRestore}
        openHistoryOnLoad={openHistoryOnLoad}
      />
    </Box>
  );
}
