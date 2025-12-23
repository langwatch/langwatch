import { Button } from "@chakra-ui/react";
import { useHandleSavePrompt } from "~/prompts/prompt-playground/hooks/useHandleSavePrompt";
import { useHasUnsavedChanges } from "~/prompts/prompt-playground/hooks/useHasUnsavedChanges";
import { useTabId } from "../ui/TabContext";

/**
 * SavePromptButton
 * Single Responsibility: Renders a save button that reflects and controls the save state of the current prompt.
 */
export function SavePromptButton() {
  const { handleSaveVersion } = useHandleSavePrompt();
  const tabId = useTabId();
  const hasUnsavedChanges = useHasUnsavedChanges(tabId);

  return (
    <Button
      onClick={handleSaveVersion}
      disabled={!hasUnsavedChanges}
      colorPalette="blue"
    >
      {hasUnsavedChanges ? "Save" : "Saved"}
    </Button>
  );
}
