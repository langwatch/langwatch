import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useProjectHasTraces } from "../../hooks/useProjectHasTraces";
import { INITIAL_TIME_RANGE, useFilterStore } from "../../stores/filterStore";
import { useViewStore } from "../../stores/viewStore";
import { useOnboardingActive } from "./useOnboardingActive";
import { useOnboardingStore } from "../store/onboardingStore";

export interface OnboardingEntryState {
  /**
   * Launch the empty-state journey on top of the current page state.
   * For new-user (firstMessage=false) projects this just clears any
   * dismissal. For existing-customer projects it sets `tourActive`
   * so the journey runs over the real data table. Always safe to
   * call — exits cleanly via `onEndTour`.
   */
  onLaunchTour: () => void;
  /**
   * End the active tour — flips the per-project dismissal flag on
   * and clears the `tourActive` override so the empty-state pane
   * unmounts immediately and the user lands in the clean (real)
   * table. Invalidates the trace list cache so the first real fetch
   * after the tour isn't satisfied by any pre-flight cached entries.
   */
  onEndTour: () => void;
  /**
   * Whether the empty-state journey is currently rendering. The
   * toolbar uses this to swap the Tour button into its "On safari"
   * exit state.
   */
  tourActive: boolean;
  /**
   * Whether the toolbar should be showing the "SDK connection
   * pending" affordance. True only when the project has *never*
   * received a real trace and the user has dismissed the empty-state
   * card; false otherwise. Existing customers and active-tour states
   * don't need this — the Tour button is the entry point.
   */
  sdkPendingVisible: boolean;
  /**
   * Click handler for the "SDK pending" button. Re-opens the
   * empty-state journey for the current project (clears the
   * dismissal flag).
   */
  onResume: () => void;
}

/**
 * Single source of truth for the toolbar's onboarding entry points.
 * The toolbar uses this hook for both the Tour button (existing
 * customers + replay) and the SDK-pending button (new users who've
 * dismissed). One hook, two affordances, no direct store imports
 * from outside the onboarding module.
 */
export function useTourEntryPoints(): OnboardingEntryState {
  const { project } = useOrganizationTeamProject();
  const { hasAnyTraces } = useProjectHasTraces();
  const setupDismissedByProject = useOnboardingStore(
    (s) => s.setupDismissedByProject,
  );
  const setSetupDismissedForProject = useOnboardingStore(
    (s) => s.setSetupDismissedForProject,
  );
  const setTourActive = useOnboardingStore((s) => s.setTourActive);
  const tourActive = useOnboardingActive();
  const utils = api.useUtils();

  const projectId = project?.id;
  const setupDismissed = projectId
    ? !!setupDismissedByProject[projectId]
    : false;

  const onLaunchTour = useCallback(() => {
    if (!projectId) return;
    // Always clear dismissal when explicitly opting into the tour —
    // the user is asking for it. For existing-customer projects with
    // real data, also flip `tourActive` so the journey shows over
    // their populated table.
    setSetupDismissedForProject(projectId, false);
    setTourActive(true);
    // Purge every filter/lens/time-range tweak the user might have
    // had active so the sample-preview fixtures render unblocked
    // for the whole journey. Filters are NOT restored at tour end
    // — the tour is a clean slate and any prior state would re-
    // hide rows the moment the user lands back on the real table.
    // `useSamplePreview` substring-matches on `debouncedQueryText`,
    // and the time-range filters real fetches once preview ends —
    // both need to be at defaults.
    useViewStore.getState().selectLens("all-traces");
    const filter = useFilterStore.getState();
    filter.clearAll();
    filter.setTimeRange(INITIAL_TIME_RANGE);
    // `clearAll` only updates `queryText` — `debouncedQueryText` (the
    // value `useSamplePreview` actually filters against) doesn't
    // catch up until `useDebouncedFilterCommit` fires its 300ms
    // timer. Force-commit so the debounced value is empty by the
    // time the journey paints.
    filter.commitDebounced();
  }, [projectId, setSetupDismissedForProject, setTourActive]);

  const onResume = useCallback(() => {
    if (!projectId) return;
    setSetupDismissedForProject(projectId, false);
  }, [projectId, setSetupDismissedForProject]);

  const onEndTour = useCallback(() => {
    if (!projectId) return;
    // Mirror what the old "Done exploring" banner button did: dismiss
    // for this project, drop the `tourActive` override so existing-
    // customer re-entries also fall back to the real table, and
    // invalidate the list cache so the first real fetch isn't served
    // from a pre-flight cached entry.
    setSetupDismissedForProject(projectId, true);
    setTourActive(false);
    void utils.tracesV2.list.invalidate({ projectId });
  }, [projectId, setSetupDismissedForProject, setTourActive, utils]);

  return {
    onLaunchTour,
    onEndTour,
    tourActive,
    sdkPendingVisible: hasAnyTraces === false && setupDismissed,
    onResume,
  };
}
