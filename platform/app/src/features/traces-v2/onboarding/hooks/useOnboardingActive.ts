import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useProjectHasTraces } from "../../hooks/useProjectHasTraces";
import { useOnboardingStore } from "../store/onboardingStore";

/**
 * "Is the onboarding overlay rendering right now?".
 *
 * Three inputs combine into one boolean so consumers (TracesPage chrome
 * dim, sidebar visibility forks) don't have to know how onboarding
 * activation is decided:
 *
 *   - `setupDismissed` — per-project, persisted. Clicking Done /
 *     Skip flips this true; the toolbar's Resume button flips it
 *     back. Always wins — once you're out, you're out.
 *   - `hasAnyTraces === false` — auto-fire for genuinely new
 *     projects (firstMessage flag is false on the project model).
 *   - `tourActive` — explicit override flipped by the toolbar Tour
 *     button so existing customers can opt into the demo even with
 *     real data in their table.
 *
 * The journey shows iff `!setupDismissed && (hasAnyTraces === false ||
 * tourActive)`. Any decoration component that mounts onboarding UI
 * should gate on this hook so we don't add DOM nodes for users who
 * aren't seeing the journey.
 */
export function useOnboardingActive(): boolean {
  const { project } = useOrganizationTeamProject();
  const { hasAnyTraces } = useProjectHasTraces();
  const setupDismissedByProject = useOnboardingStore(
    (s) => s.setupDismissedByProject,
  );
  const tourActive = useOnboardingStore((s) => s.tourActive);

  if (!project) return false;
  if (setupDismissedByProject[project.id]) return false;
  return hasAnyTraces === false || tourActive;
}
