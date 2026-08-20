import type { Window } from "../../prompt-playground-store/DraggableTabsBrowserStore";

/**
 * The prompt the workspace is currently showing, or null when the workspace is
 * empty. This is what the prompts list marks as selected.
 *
 * Only one prompt is ever named. A prompt open in a background tab, or in the
 * pane the user is not working in, is not marked: the list answers "which one
 * am I looking at", and marking every open prompt would answer a different
 * question badly. With no active pane recorded yet — the state right after a
 * reload — the first pane stands in, because that is the one on screen.
 */
export function activePromptId({
  windows,
  activeWindowId,
}: {
  windows: Window[];
  activeWindowId: string | null;
}): string | null {
  const activeWindow =
    windows.find((w) => w.id === activeWindowId) ?? windows[0];
  if (!activeWindow) return null;
  const activeTab = activeWindow.tabs.find(
    (t) => t.id === activeWindow.activeTabId,
  );
  return activeTab?.data.form.currentValues.configId ?? null;
}
