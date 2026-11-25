// Governance scope: host handles landing policy (redirects), hook returns org/graph/permissions.
// Options object removed (redirects gone).

import { useMemo } from "react";

import { useGovernanceHost, type GovernanceOrganization } from "../model/governance-host.ts";

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
