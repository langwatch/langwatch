import {
  useDraggableTabsBrowserStore,
  type Tab,
} from "./DraggableTabsBrowserStore";

/**
 * useTabById
 *
 * Single Responsibility: Find one tab in the store by its id.
 *
 * Tabs are stored per window, so reaching one by id alone means flattening the
 * windows first. `find` hands back the stored tab itself, so the selector's
 * result is referentially stable and will not re-render its consumer on every
 * unrelated store write.
 */
export function useTabById(tabId: string): Tab | undefined {
  return useDraggableTabsBrowserStore((state) =>
    state.windows
      .flatMap((window) => window.tabs)
      .find((tab) => tab.id === tabId),
  );
}
