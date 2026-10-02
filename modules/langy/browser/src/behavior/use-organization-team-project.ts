/**
 * The scope reading the dock has always made, answered by the host.
 */

import { useUiScope } from "@langwatch/browser-host/capabilities";

import { useLangyHost } from "../model/langy-host.ts";

export function useOrganizationTeamProject(_options?: {
  redirectToProjectOnboarding?: boolean;
  redirectToOnboarding?: boolean;
  keepFetching?: boolean;
}) {
  const host = useLangyHost();
  const scopeHost = useUiScope().scopeHost();
  const project = host.project();
  return {
    project,
    /** The platform hook published it flat as well, and call sites read it that way. */
    projectId: project?.id,
    organization: host.organization(),
    team: host.team(),
    organizationRole: host.organizationRole(),
    isDemoProject: host.isDemoProject(),
    hasPermission: (permission: string) => host.hasPermission(permission),
    /** Organization scope only; fails closed where no scope host is mounted. */
    hasOrgPermission: (permission: string) =>
      scopeHost?.hasOrganizationPermission(permission) ?? false,
    isLoading: host.isLoading(),
    isRefetching: false,
  };
}
