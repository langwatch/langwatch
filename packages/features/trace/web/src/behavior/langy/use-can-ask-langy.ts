import { useOrganizationTeamProject } from "../use-organization-team-project";

/**
 * "May this reader START a conversation?" — the other half of Langy's permission pair.
 * Spec: specs/home/langy-home.feature
 */
export function useCanAskLangy(): boolean {
  const { hasPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  return hasPermission("langy:create");
}
