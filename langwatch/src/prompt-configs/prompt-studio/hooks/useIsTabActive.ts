import { useTabId } from "../components/prompt-browser/prompt-browser-window/PromptBrowserWindowContent";
import { useDraggableTabsBrowserStore } from "../prompt-studio-store/DraggableTabsBrowserStore";

export function useIsTabActive() {
  const tabId = useTabId();
  return useDraggableTabsBrowserStore((state) => state.isTabIdActive(tabId));
}
