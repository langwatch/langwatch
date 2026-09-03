import { useLatestPromptVersion } from "../../../../behavior/use-latest-prompt-version";
import { NEW_PROMPT_TITLE } from "../../../../surfaces/prompt-reference";
import { shouldShowVersionBadge } from "../../studio-internals";
import { useHasUnsavedChanges } from "../../../../behavior/use-has-unsaved-changes";
import { useDraggableTabsBrowserStore } from "../../../../behavior/use-prompt-tabs-browser-store";
import { useTabById } from "../../../../behavior/use-tab-by-id";

/** What a prompt tab displays about itself, wherever it is displayed. */
export interface PromptTabSummary {
  /**
   * The prompt's full handle, folder and all (`onboarding/welcome`), or a
   * placeholder when it has never been saved. Callers decide how much of it to
   * show: a tab has room only for the name, a switcher row shows the folder too.
   */
  title: string;
  hasUnsavedChanges: boolean;
  /** The version this tab has loaded. Absent on a prompt never saved. */
  versionNumber?: number;
  /** The newest version in the database, if known. */
  latestVersion?: number;
  isOutdated: boolean;
  showVersionBadge: boolean;
}

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
  const tab = useTabById(tabId);
  const hasUnsavedChanges = useHasUnsavedChanges(tabId);

  const configId = tab?.data.form.currentValues?.configId;
  const versionNumber = tab?.data.meta.versionNumber;

  const { latestVersion, isOutdated } = useLatestPromptVersion({
    configId,
    currentVersion: versionNumber,
    // One instance per open tab, all always mounted: keeping them focus-live
    // is the N-tab query storm from #5585.
    isLiveRefetchEnabled: false,
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
