import { Button } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompts";
import { useHandleSavePrompt } from "~/prompts/prompt-playground/hooks/useHandleSavePrompt";
import { useHasUnsavedChanges } from "~/prompts/prompt-playground/hooks/useHasUnsavedChanges";
import { useTabId } from "../ui/TabContext";

/**
 * SavePromptButton
 * Single Responsibility: Renders a save button that reflects and controls the save state of the current prompt.
 * Shows "Save" for new prompts, "Update to vX" for existing prompts.
 */
export function SavePromptButton() {
  const { handleSaveVersion } = useHandleSavePrompt();
  const tabId = useTabId();
  const hasUnsavedChanges = useHasUnsavedChanges(tabId);
  const form = useFormContext<PromptConfigFormValues>();
  const currentVersion = form.watch("versionMetadata.versionNumber");

  const getButtonLabel = () => {
    if (!hasUnsavedChanges) return "Saved";
    if (currentVersion) return `Update to v${currentVersion + 1}`;
    return "Save";
  };

  return (
    <Button
      onClick={handleSaveVersion}
      disabled={!hasUnsavedChanges}
      colorPalette="blue"
    >
      {getButtonLabel()}
    </Button>
  );
}
