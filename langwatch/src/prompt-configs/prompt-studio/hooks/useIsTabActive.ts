import { useTabId } from "../components/prompt-browser/prompt-browser-window/PromptBrowserWindowContent";
import { useDraggableTabsBrowserStore } from "../prompt-studio-store/DraggableTabsBrowserStore";

/**
 * useIsTabActive
 * Single Responsibility: Determines if the current tab is the active tab in its window.
 * @returns true if the current tab is active, false otherwise
 */
export function useIsTabActive() {
  const tabId = useTabId();
  return useDraggableTabsBrowserStore((state) => state.isTabIdActive(tabId));
}
