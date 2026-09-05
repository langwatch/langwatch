/**
 * The scope reading these screens have always made, answered by the host.
 */

import { useScenarioHost } from "../model/scenario-host";

export function useOrganizationTeamProject(_options?: {
  redirectToProjectOnboarding?: boolean;
  redirectToOnboarding?: boolean;
  keepFetching?: boolean;
}) {
  const host = useScenarioHost();
  const project = host.project();
  return {
    project,
    /** The platform hook published it flat as well, and one call site reads it that way. */
    projectId: project?.id,
    organization: host.organization(),
    team: host.team(),
    organizationRole: host.organizationRole(),
    hasPermission: (permission: string) => host.hasPermission(permission),
    isLoading: host.isLoading(),
    isRefetching: false,
  };
}
