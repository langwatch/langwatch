/**
 * The reads the governance screens used to get from `useGovernanceScope`.
 *
 * The platform hook resolved the active scope AND redirected on it: an admin
 * without a project was bounced to onboarding unless the caller opted out, which
 * is why every governance page passed `redirectToOnboarding: false`. Landing
 * policy is not a screen's business and does not travel with it, so what is left
 * here is the reading half — the organization the page is about, the graph it
 * names teams out of, and what the caller may do in it — served by the host.
 *
 * The options object is gone with the redirects it configured. That is the one
 * shape change every call site of this hook carries.
 */

import { useMemo } from "react";
import { useGovernanceHost, type GovernanceOrganization } from "../model/governance-host";

export type GovernanceScopeReading = {
  organization: GovernanceOrganization | undefined;
  organizations: readonly GovernanceOrganization[];
  hasAnyPermission: (permission: string) => boolean;
};

export function useGovernanceScope(): GovernanceScopeReading {
  const host = useGovernanceHost();
  return useMemo(
    () => ({
      organization: host.organization(),
      organizations: host.organizations(),
      hasAnyPermission: (permission: string) => host.hasPermission(permission),
    }),
    [host],
  );
}

/** Which plan the organization is on, for the enterprise-gated surfaces. */
export function useGovernancePlan(): { isEnterprise: boolean; isLoading: boolean } {
  return useGovernanceHost().plan();
}
