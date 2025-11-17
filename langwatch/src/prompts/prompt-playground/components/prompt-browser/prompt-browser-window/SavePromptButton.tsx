import { Button } from "@chakra-ui/react";
import { useHandleSavePrompt } from "~/prompts/prompt-playground/hooks/useHandleSavePrompt";
import { useTabId } from "../ui/TabContext";
import { useHasUnsavedChanges } from "~/prompts/prompt-playground/hooks/useHasUnsavedChanges";

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
      variant="outline"
    >
      {hasUnsavedChanges ? "Save" : "Saved"}
    </Button>
  );
}
