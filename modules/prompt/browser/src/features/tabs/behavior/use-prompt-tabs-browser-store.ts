/**
 * The tab store, bound to the project in scope and to the host's browser.
 * A browser module may not name `window.localStorage` or a real
 * logger directly, so the HOST answers both through `tabCapabilities()`.
 */

import { usePromptProject } from "../../../behavior/use-prompt-project.ts";
import { usePromptHost } from "../../../model/prompt-host.ts";
import type { DraggableTabsBrowserState } from "./prompt-tabs-store.ts";
import { usePromptTabsStore } from "./prompt-tabs-store.ts";

export function useDraggableTabsBrowserStore<T>(
  selector: (state: DraggableTabsBrowserState) => T,
): T {
  const { projectId } = usePromptProject();
  const capabilities = usePromptHost().tabCapabilities();
  return usePromptTabsStore({ projectId, capabilities }, selector);
}
