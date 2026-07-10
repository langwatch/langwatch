import { useLatestPromptVersion } from "~/prompts/hooks/useLatestPromptVersion";
import { useHasUnsavedChanges } from "../../../hooks/useHasUnsavedChanges";
import { useDraggableTabsBrowserStore } from "../../../prompt-playground-store/DraggableTabsBrowserStore";
import { shouldShowVersionBadge } from "./shouldShowVersionBadge";

/** What a prompt tab displays about itself, wherever it is displayed. */
export interface PromptTabSummary {
  /** The prompt's title, or a placeholder when it has never been saved. */
  title: string;
  hasUnsavedChanges: boolean;
  /** The version this tab has loaded. Absent on a prompt never saved. */
  versionNumber?: number;
  /** The newest version in the database, if known. */
  latestVersion?: number;
  isOutdated: boolean;
  showVersionBadge: boolean;
}

export const NEW_PROMPT_TITLE = "New Prompt";

/**
 * usePromptTabSummary
 *
 * Single Responsibility: Derive everything a prompt tab displays about itself —
 * title, unsaved state, and version — from the tab store and the prompt queries.
 *
 * Owned here rather than in the tab component so the tab strip and the tab
 * switcher render the same facts from the same source, and cannot drift.
 */
export function usePromptTabSummary(tabId: string): PromptTabSummary {
  const tab = useDraggableTabsBrowserStore((state) =>
    state.windows.flatMap((w) => w.tabs).find((t) => t.id === tabId),
  );
  const hasUnsavedChanges = useHasUnsavedChanges(tabId);

  const configId = tab?.data.form.currentValues?.configId;
  const versionNumber = tab?.data.meta.versionNumber;

  const { latestVersion, isOutdated } = useLatestPromptVersion({
    configId,
    currentVersion: versionNumber,
  });

  // Derived inside the selector so it returns a boolean. Returning the tab
  // array itself would hand back a fresh reference on every store read and
  // re-render this hook's consumer forever.
  const showVersionBadge = useDraggableTabsBrowserStore((state) =>
    shouldShowVersionBadge({
      isOutdated,
      configId,
      allTabsData: state.windows
        .flatMap((w) => w.tabs)
        .map((t) => ({
          configId: t.data.form.currentValues?.configId,
          versionNumber: t.data.meta.versionNumber,
        })),
    }),
  );

  return {
    title: tab?.data.meta.title ?? NEW_PROMPT_TITLE,
    hasUnsavedChanges,
    versionNumber,
    latestVersion,
    isOutdated,
    showVersionBadge,
  };
}
