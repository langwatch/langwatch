import { useOrganizationTeamProject } from "../../use-organization-team-project.ts";
import { useProjectHasTraces } from "../use-project-has-traces.ts";
import { useOnboardingStore } from "./store/onboarding-store.ts";

/**
 * "Is the onboarding overlay rendering right now?".
 */
export function useOnboardingActive(): boolean {
  const { project } = useOrganizationTeamProject();
  const { hasAnyTraces } = useProjectHasTraces();
  const setupDismissedByProject = useOnboardingStore((s) => s.setupDismissedByProject);
  const tourActive = useOnboardingStore((s) => s.tourActive);

  if (!project) return false;
  if (setupDismissedByProject[project.id]) return false;
  return hasAnyTraces === false || tourActive;
}
