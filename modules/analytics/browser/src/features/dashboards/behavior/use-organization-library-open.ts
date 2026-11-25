/**
 * Whether the organization's Dashboards area opens: Dashboards on for the organization,
 * decided by the rule the navigation shell uses (ADR-002), so a page or a link to `/dashboards`
 * never disagrees with the shell. Loading until the organization and the flag answer.
 */

import {
  ORGANIZATION_DASHBOARDS_FLAG,
  ORGANIZATION_DASHBOARDS_FLAGS_STALE_TIME_MS,
  organizationDashboardsArea,
} from "@langwatch/analytics-client";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";

export type OrganizationLibraryState = { isOpen: boolean; isLoading: boolean };

/** `enabled` false asks nothing and answers shut. */
export function useOrganizationLibraryOpen({
  enabled = true,
}: {
  enabled?: boolean;
} = {}): OrganizationLibraryState {
  const organizationId = useAnalyticsHost().organizationId();
  const organizationIds = organizationId === void 0 ? [] : [organizationId];
  const options = {
    enabled: enabled && organizationId !== void 0,
    staleTime: ORGANIZATION_DASHBOARDS_FLAGS_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  };
  const dashboards = analyticsApi.featureFlag.isEnabledForEachOrganization.useQuery(
    { flag: ORGANIZATION_DASHBOARDS_FLAG, organizationIds },
    options,
  );
  if (!enabled) return { isOpen: false, isLoading: false };
  const area = organizationDashboardsArea({ organizationId, dashboards });
  return { isOpen: area === "open", isLoading: area === "loading" };
}
