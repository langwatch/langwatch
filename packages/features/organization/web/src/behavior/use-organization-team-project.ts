/**
 * `useOrganizationTeamProject`, answered off the host port.
 *
 * NAMED AFTER THE HOOK IT REPLACES, deliberately: the traces family's rule —
 * "a shim named after the hook it replaces is worth more than a better name" —
 * is what keeps every destructuring call site in this family unedited. The
 * platform hook resolved the whole organization graph for one id and handed
 * back nine fields; the four this family reads arrive from the host, which the
 * frontend feature already resolved once for the document.
 *
 * WHAT DOES NOT TRAVEL is the redirect-to-onboarding bouncer. That is landing
 * policy and belongs to whatever serves the address, exactly as the traces
 * family recorded. The options object is accepted and ignored so a caller that
 * passed one still compiles.
 */

import {
  useOrganizationHost,
  type OrganizationProjectReading,
  type OrganizationReading,
} from "../model/organization-host";

export type OrganizationTeamProjectReading = {
  organization: OrganizationReading | undefined;
  project: OrganizationProjectReading | undefined;
  hasPermission: (permission: string) => boolean;
  hasOrgPermission: (permission: string) => boolean;
};

export function useOrganizationTeamProject(_options?: {
  redirectToOnboarding?: boolean;
}): OrganizationTeamProjectReading {
  const host = useOrganizationHost();
  return {
    organization: host.organization(),
    project: host.activeProject(),
    hasPermission: (permission) => host.hasPermission(permission),
    hasOrgPermission: (permission) => host.hasOrganizationPermission(permission),
  };
}
