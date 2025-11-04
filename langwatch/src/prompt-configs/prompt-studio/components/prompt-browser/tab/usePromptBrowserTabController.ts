import { useTabId } from "../ui/TabContext";
import { useDraggableTabsBrowserStore } from "../../../prompt-studio-store/DraggableTabsBrowserStore";
import { useHasUnsavedChanges } from "../../../hooks/useHasUnsavedChanges";

interface PromptBrowserTabControllerProps {
  onRemove: () => void;
  dimmed?: boolean;
}

/**
 * Manages tab state and provides close handler with unsaved changes confirmation.
 * Single Responsibility: Control prompt browser tab behavior including unsaved changes detection.
 * @param props - Controller properties including onRemove callback
 * @returns Tab data, unsaved changes flag, and close handler
 */
export function usePromptBrowserTabController({
  onRemove,
}: PromptBrowserTabControllerProps) {
  const tabId = useTabId();
  const hasUnsavedChanges = useHasUnsavedChanges(tabId);

  const tab = useDraggableTabsBrowserStore((state) =>
    state.windows.flatMap((w) => w.tabs).find((t) => t.id === tabId),
  );

  const isNewPrompt = !Boolean(tab?.data.form.currentValues?.configId);

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (hasUnsavedChanges || isNewPrompt) {
      if (!confirm("Your unsaved changes will be lost. Proceed anyway?")) {
        return;
      }
    }

    onRemove();
  };

  return {
    tab,
    hasUnsavedChanges,
    handleClose,
  };
}
