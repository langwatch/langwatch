/**
 * The tab store, bound to the project in scope and to the host's browser.
 *
 * `platform/app` bound the store to `window.localStorage` and a real logger in
 * an app adapter; a feature-web package may name neither, so the HOST answers
 * both through `tabCapabilities()`. That is this family's one addition to a
 * host port shape nine families before it declared — the open prompt tabs are
 * persisted per project, one key per tab, and the store already took its
 * storage and its logger as arguments.
 */

import type { DraggableTabsBrowserState } from "../model/prompt-tabs-store";
import { usePromptTabsStore } from "../model/prompt-tabs-store";
import { usePromptHost } from "../model/prompt-host";
import { usePromptProject } from "./use-prompt-project";

export function useDraggableTabsBrowserStore<T>(
  selector: (state: DraggableTabsBrowserState) => T,
): T {
  const { projectId } = usePromptProject();
  const capabilities = usePromptHost().tabCapabilities();
  return usePromptTabsStore({ projectId, capabilities }, selector);
}
