import { useTabId } from "../ui/TabContext";
import { useDraggableTabsBrowserStore } from "../../../prompt-playground-store/DraggableTabsBrowserStore";
import { useHasUnsavedChanges } from "../../../hooks/useHasUnsavedChanges";

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

  const isNewPrompt = !Boolean(tab?.data.form.currentValues?.configId);

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
  };
}
