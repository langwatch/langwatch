import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useOnboardingStore } from "../store/onboardingStore";

/**
 * "Is the onboarding overlay rendering right now?".
 *
 * The journey is OPT-IN: it shows iff the user has explicitly launched
 * the tour (`tourActive`), not automatically for new projects. A
 * never-traced project shows the normal centered empty state with a
 * "Take the tour" button instead — auto-dropping a first-time visitor
 * into the animated walkthrough was too busy.
 *
 *   - `setupDismissed` — per-project, persisted. Ending the tour flips
 *     this true; relaunching flips it back. Always wins.
 *   - `tourActive` — flipped true by the "Take the tour" button (empty
 *     state or toolbar) and false when the tour ends.
 *
 * The journey shows iff `!setupDismissed && tourActive`. Any decoration
 * component that mounts onboarding UI should gate on this hook so we
 * don't add DOM nodes for users who aren't seeing the journey.
 */
export function useOnboardingActive(): boolean {
  const { project } = useOrganizationTeamProject();
  const setupDismissedByProject = useOnboardingStore(
    (s) => s.setupDismissedByProject,
  );
  const tourActive = useOnboardingStore((s) => s.tourActive);

  if (!project) return false;
  if (setupDismissedByProject[project.id]) return false;
  return tourActive;
}
