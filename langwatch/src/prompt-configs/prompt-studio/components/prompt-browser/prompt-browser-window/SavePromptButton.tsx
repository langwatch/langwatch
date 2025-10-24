import { Button } from "@chakra-ui/react";
import { useHandleSavePrompt } from "~/prompt-configs/prompt-studio/hooks/useHandleSavePrompt";
import { useTabId } from "../ui/TabContext";
import { useHasUnsavedChanges } from "~/prompt-configs/prompt-studio/hooks/useHasUnsavedChanges";

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
