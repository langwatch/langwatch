import { useOrganizationTeamProject } from "../../use-organization-team-project";
import { useProjectHasTraces } from "../use-project-has-traces";
import { useOnboardingStore } from "./store/onboarding-store";

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
