/** Organization/team/project reading from host port; named after replaced hook. */

import {
  useOrganizationHost,
  type OrganizationProjectReading,
  type OrganizationReading,
} from "../model/organization-host.ts";

export type OrganizationTeamProjectReading = {
  organization: OrganizationReading | undefined;
  project: OrganizationProjectReading | undefined;
};

export function useOrganizationTeamProject(_options?: {
  redirectToOnboarding?: boolean;
}): OrganizationTeamProjectReading {
  const host = useOrganizationHost();
  return {
    organization: host.organization(),
    project: host.activeProject(),
  };
}
