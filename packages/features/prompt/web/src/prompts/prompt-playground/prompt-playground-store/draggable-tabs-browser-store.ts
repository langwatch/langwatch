"use client";
import { createLogger } from "@langwatch/observability";
import {
  type DraggableTabsBrowserState,
  type PromptTabsCapabilities,
  usePromptTabsStore,
} from "@langwatch/prompt-web/screens/prompt-studio";

import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";

const logger = createLogger("DraggableTabsBrowserStore");

/**
 * The browser services the packaged tab store runs on.
 *
 * Read through a getter rather than captured once: the module is imported
 * during the app's boot graph, and `window` is not guaranteed to exist at that
 * moment, while every call that reaches the store happens in a render.
 */
const capabilities: PromptTabsCapabilities = {
  get storage() {
    return window.localStorage;
  },
  logger,
};

/**
 * App composition adapter for the prompt-tab store.
 *
 * The store itself lives in `@langwatch/prompt-web` and takes the project id
 * and its browser capabilities as arguments; this binds it to the project the
 * user is currently in and to the real browser, which are the two pieces the
 * package cannot know.
 */
export function useDraggableTabsBrowserStore<T>(
  selector: (state: DraggableTabsBrowserState) => T,
): T {
  const { projectId } = useOrganizationTeamProject();
  return usePromptTabsStore({ projectId, capabilities }, selector);
}
