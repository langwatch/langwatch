import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useProjectHasTraces } from "../../hooks/useProjectHasTraces";
import { useOnboardingStore } from "../store/onboardingStore";

export interface OnboardingEntryState {
  /**
   * Launch the empty-state journey on top of the current page state.
   * For new-user (firstMessage=false) projects this just clears any
   * dismissal. For existing-customer projects it sets `tourActive`
   * so the journey runs over the real data table. Always safe to
   * call — exits cleanly via "Done exploring" or "Skip for now".
   */
  onLaunchTour: () => void;
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
  }, [projectId, setSetupDismissedForProject, setTourActive]);

  const onResume = useCallback(() => {
    if (!projectId) return;
    setSetupDismissedForProject(projectId, false);
  }, [projectId, setSetupDismissedForProject]);

  return {
    onLaunchTour,
    sdkPendingVisible: hasAnyTraces === false && setupDismissed,
    onResume,
  };
}
