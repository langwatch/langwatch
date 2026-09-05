import { useCallback } from "react";
import { useOrganizationTeamProject } from "../../../../../behavior/use-organization-team-project";
import { api } from "../../../trace-api";
import { useProjectHasTraces } from "../../../../../behavior/explorer/use-project-has-traces";
import { INITIAL_TIME_RANGE, useFilterStore, useViewStore } from "../../../../../index";
import { useOnboardingStore } from "../../../../../behavior/explorer/onboarding/store/onboarding-store";
import { useOnboardingActive } from "../../../../../behavior/explorer/onboarding/use-onboarding-active";

export interface OnboardingEntryState {
  /**
   * Launch the empty-state journey on top of the current page state. For new-user
   * (firstMessage=false) projects this just clears any dismissal. For existing-customer
   * projects it sets `tourActive` so the journey runs over the real data table.
   */
  onLaunchTour: () => void;
  /**
   * End the active tour — flips the per-project dismissal flag on and clears the
   * `tourActive` override so the empty-state pane unmounts immediately and the user
   * lands in the clean (real) table.
   */
  onEndTour: () => void;
  /**
   * Whether the empty-state journey is currently rendering. The
   * toolbar uses this to swap the Tour button into its "On safari"
   * exit state.
   */
  tourActive: boolean;
  /**
   * Whether the toolbar should be showing the "SDK connection pending" affordance. True
   * only when the project has *never* received a real trace and the user has dismissed
   * the empty-state card; false otherwise.
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
 * Single source of truth for the toolbar's onboarding entry points. The toolbar uses
 * this hook for both the Tour button (existing customers + replay) and the SDK-pending
 * button (new users who've dismissed).
 */
export function useTourEntryPoints(): OnboardingEntryState {
  const { project } = useOrganizationTeamProject();
  const { hasAnyTraces } = useProjectHasTraces();
  const setupDismissedByProject = useOnboardingStore((s) => s.setupDismissedByProject);
  const setSetupDismissedForProject = useOnboardingStore((s) => s.setSetupDismissedForProject);
  const setTourActive = useOnboardingStore((s) => s.setTourActive);
  const tourActive = useOnboardingActive();
  const utils = api.useUtils();

  const projectId = project?.id;
  const setupDismissed = projectId ? !!setupDismissedByProject[projectId] : false;

  const onLaunchTour = useCallback(() => {
    if (!projectId) return;
    // Always clear dismissal when explicitly opting into the tour —
    // the user is asking for it. For existing-customer projects with
    // real data, also flip `tourActive` so the journey shows over
    // their populated table.
    setSetupDismissedForProject(projectId, false);
    setTourActive(true);
    // Purge every filter/lens/time-range tweak the user might have had active so the
    // sample-preview fixtures render unblocked for the whole journey.
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
    // customer re-entries also fall back to the real table, and reset
    // the list cache so the first real fetch flows through skeleton
    // rather than lingering stale sample rows.
    setSetupDismissedForProject(projectId, true);
    setTourActive(false);
    // Use reset (not invalidate) so the cache is purged immediately — the next
    // useTraceListQuery flows through isLoading=true → skeleton instead of keeping the
    // stale sample rows visible until the real fetch lands.
    void utils.tracesV2.list.reset();
  }, [projectId, setSetupDismissedForProject, setTourActive, utils]);

  return {
    onLaunchTour,
    onEndTour,
    tourActive,
    sdkPendingVisible: hasAnyTraces === false && setupDismissed,
    onResume,
  };
}
