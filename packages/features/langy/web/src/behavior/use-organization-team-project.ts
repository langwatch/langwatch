/**
 * The scope reading the dock has always made, answered by the host.
 */

import { useLangyHost } from "../model/langy-host";

export function useOrganizationTeamProject(_options?: {
  redirectToProjectOnboarding?: boolean;
  redirectToOnboarding?: boolean;
  keepFetching?: boolean;
}) {
  const host = useLangyHost();
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
    /**
     * A grant asked ABOUT THE ORGANIZATION rather than the project.
     */
    hasOrgPermission: (permission: string) => host.hasPermission(permission),
    isLoading: host.isLoading(),
    isRefetching: false,
  };
}
