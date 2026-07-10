import { useCallback } from "react";
import { usePrompts } from "~/prompts/hooks/usePrompts";
import { versionedPromptToPromptConfigFormValuesWithSystemMessage } from "~/prompts/utils/llmPromptConfigUtils";
import { useDraggableTabsBrowserStore } from "../../../prompt-playground-store/DraggableTabsBrowserStore";
import { useTabId } from "../ui/TabContext";
import { usePromptTabSummary } from "./usePromptTabSummary";

/**
 * Manages tab state and provides close handler with unsaved changes confirmation.
 * Single Responsibility: Control prompt browser tab behavior including unsaved changes detection.
 * @returns Tab data, unsaved changes flag, and close handler
 */
export function usePromptBrowserTabController() {
  const tabId = useTabId();

  // What the tab displays is derived once, in the hook the tab switcher's rows
  // also read, so the two renderings of a tab cannot disagree.
  const { hasUnsavedChanges, latestVersion, isOutdated, showVersionBadge } =
    usePromptTabSummary(tabId);

  const tab = useDraggableTabsBrowserStore((state) =>
    state.windows.flatMap((w) => w.tabs).find((t) => t.id === tabId),
  );
  const removeTab = useDraggableTabsBrowserStore((state) => state.removeTab);
  const updateTabData = useDraggableTabsBrowserStore(
    (state) => state.updateTabData,
  );

  const configId = tab?.data.form.currentValues?.configId;
  const isNewPrompt = !Boolean(configId);

  const { getPromptById } = usePrompts();

  /**
   * handleUpgrade
   * Single Responsibility: Loads the latest version from DB into the tab.
   */
  const handleUpgrade = useCallback(async () => {
    if (!configId) return;

    try {
      const latestPrompt = await getPromptById({ id: configId });
      if (!latestPrompt) throw new Error("Prompt not found");

      const newFormValues =
        versionedPromptToPromptConfigFormValuesWithSystemMessage(latestPrompt);

      updateTabData({
        tabId,
        updater: (data) => ({
          ...data,
          form: {
            currentValues: newFormValues,
          },
          meta: {
            ...data.meta,
            versionNumber: latestPrompt.version,
          },
        }),
      });
    } catch (error) {
      console.error("Failed to load latest prompt version:", error);
    }
  }, [configId, getPromptById, tabId, updateTabData]);

  /**
   * handleClose
   * Single Responsibility: Confirms unsaved changes before closing tab.
   * @param e - Click event to stop propagation
   */
  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (hasUnsavedChanges || isNewPrompt) {
      if (!confirm("Your unsaved changes will be lost. Proceed anyway?")) {
        return;
      }
    }

    removeTab({ tabId });
  };

  return {
    tab,
    hasUnsavedChanges,
    handleClose,
    latestVersion,
    isOutdated,
    handleUpgrade,
    showVersionBadge,
  };
}
