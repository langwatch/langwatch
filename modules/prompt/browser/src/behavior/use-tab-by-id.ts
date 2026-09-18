import type { Tab } from "../model/prompt-tabs-store.ts";
import { useDraggableTabsBrowserStore } from "./use-prompt-tabs-browser-store.ts";

/**
 * Finds one tab in the store by id, flattening windows first. `find` hands
 * back the stored tab itself, so the selector's result is referentially
 * stable and won't re-render its consumer on every unrelated store write.
 */
export function useTabById(tabId: string): Tab | undefined {
  return useDraggableTabsBrowserStore((state) =>
    state.windows.flatMap((window) => window.tabs).find((tab) => tab.id === tabId),
  );
}
