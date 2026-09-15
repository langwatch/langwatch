/**
 * The tab store, bound to the project in scope and to the host's browser.
 * A feature-web package may not name `window.localStorage` or a real
 * logger directly, so the HOST answers both through `tabCapabilities()`.
 */

import type { DraggableTabsBrowserState } from "../model/prompt-tabs-store.ts";
import { usePromptTabsStore } from "../model/prompt-tabs-store.ts";
import { usePromptHost } from "../model/prompt-host.ts";
import { usePromptProject } from "./use-prompt-project.ts";

export function useDraggableTabsBrowserStore<T>(
  selector: (state: DraggableTabsBrowserState) => T,
): T {
  const { projectId } = usePromptProject();
  const capabilities = usePromptHost().tabCapabilities();
  return usePromptTabsStore({ projectId, capabilities }, selector);
}
