/**
 * The scope reading the explorer has always made, answered by the host.
 */

import { useTraceHost } from "./trace-host";

export function useOrganizationTeamProject(_options?: {
  redirectToProjectOnboarding?: boolean;
  redirectToOnboarding?: boolean;
  keepFetching?: boolean;
}) {
  const host = useTraceHost();
  const project = host.project();
  return {
    project,
    organization: host.organization(),
    team: host.team(),
    organizationRole: host.organizationRole(),
    hasPermission: (permission: string) => host.hasPermission(permission),
    isLoading: host.isLoading(),
    isRefetching: false,
  };
}
