import { useCallback } from "react";
import { useLatestPromptVersion } from "~/prompts/hooks/useLatestPromptVersion";
import { usePrompts } from "~/prompts/hooks/usePrompts";
import { versionedPromptToPromptConfigFormValuesWithSystemMessage } from "~/prompts/utils/llmPromptConfigUtils";
import { useHasUnsavedChanges } from "../../../hooks/useHasUnsavedChanges";
import { useDraggableTabsBrowserStore } from "../../../prompt-playground-store/DraggableTabsBrowserStore";
import { useTabId } from "../ui/TabContext";

/**
 * Manages tab state and provides close handler with unsaved changes confirmation.
 * Single Responsibility: Control prompt browser tab behavior including unsaved changes detection.
 * @returns Tab data, unsaved changes flag, and close handler
 */
export function usePromptBrowserTabController() {
  const tabId = useTabId();
  const hasUnsavedChanges = useHasUnsavedChanges(tabId);

  const tab = useDraggableTabsBrowserStore((state) =>
    state.windows.flatMap((w) => w.tabs).find((t) => t.id === tabId),
  );
  const removeTab = useDraggableTabsBrowserStore((state) => state.removeTab);
  const updateTabData = useDraggableTabsBrowserStore(
    (state) => state.updateTabData,
  );

  const isNewPrompt = !Boolean(tab?.data.form.currentValues?.configId);

  // Get version info for outdated detection
  const configId = tab?.data.form.currentValues?.configId;
  const currentVersion = tab?.data.meta.versionNumber;
  const { latestVersion, isOutdated } = useLatestPromptVersion({
    configId,
    currentVersion,
  });

  // Check if there are multiple tabs with the same prompt at DIFFERENT versions
  const hasDuplicateTabsWithDifferentVersions = useDraggableTabsBrowserStore(
    (state) => {
      if (!configId) return false;
      const allTabs = state.windows.flatMap((w) => w.tabs);
      const samePromptTabs = allTabs.filter(
        (t) => t.data.form.currentValues?.configId === configId,
      );
      if (samePromptTabs.length <= 1) return false;
      // Check if any tab has a different version
      const versions = new Set(
        samePromptTabs.map((t) => t.data.meta.versionNumber),
      );
      return versions.size > 1;
    },
  );

  // Only show version badge if outdated or there are duplicate tabs with different versions
  const showVersionBadge = isOutdated || hasDuplicateTabsWithDifferentVersions;

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
