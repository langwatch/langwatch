/**
 * "My Workspace" rows: one per governance org, or one for an org-less reader.
 * `/me` reads its org off the ambient scope `OrganizationSelect` writes.
 */

import { navigationApi } from "./navigation-api.ts";
import type { NavigationHost } from "../model/navigation-host.ts";

const GOVERNANCE_FLAG = "release_ui_ai_governance_enabled";
const CLIENT_FLAG_STALE_TIME_MS = 5 * 60_000;

export type PersonalWorkspaceEntry = {
  organizationId: string | null;
  organizationName: string | null;
  label: "My Workspace";
};

export function usePersonalWorkspaceEntries(host: NavigationHost): {
  entries: PersonalWorkspaceEntry[];
  isLoading: boolean;
} {
  const organizations = host.organizations();
  const organizationIds = organizations.map((org) => org.id);
  const enabled = organizationIds.length > 0;

  const governanceByOrg = navigationApi.featureFlag.isEnabledForEachOrganization.useQuery(
    { flag: GOVERNANCE_FLAG, organizationIds },
    {
      enabled,
      staleTime: CLIENT_FLAG_STALE_TIME_MS,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  );

  if (!enabled) {
    // An org-less reader has no governance gate to pass: the personal
    // workspace is their only context, so it renders unconditionally.
    return {
      entries: [{ organizationId: null, organizationName: null, label: "My Workspace" }],
      isLoading: false,
    };
  }

  const enabledByOrg = governanceByOrg.data?.enabledByOrganizationId ?? {};
  const entries = organizations
    .filter((org) => enabledByOrg[org.id])
    .map((org) => ({
      organizationId: org.id,
      organizationName: org.name,
      label: "My Workspace" as const,
    }));

  return { entries, isLoading: governanceByOrg.isLoading };
}
