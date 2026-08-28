"use client";
import {
  type DraggableTabsBrowserState,
  usePromptTabsStore,
} from "@langwatch/prompt-web/screens/prompt-studio";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * App composition adapter for the prompt-tab store.
 *
 * The store itself lives in `@langwatch/prompt-web` and takes the project id as
 * an argument; this binds it to the project the user is currently in, which is
 * the only piece the package cannot know.
 */
export function useDraggableTabsBrowserStore<T>(
  selector: (state: DraggableTabsBrowserState) => T,
): T {
  const { projectId } = useOrganizationTeamProject();
  return usePromptTabsStore(projectId, selector);
}
