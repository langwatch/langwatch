/**
 * Whether the organization's Dashboards area opens: both its flags on for the organization,
 * asked as the navigation shell asks them (ADR-002), so a page or a link to `/dashboards` never
 * disagrees with the shell. Not open until both answer.
 */

import {
  ORGANIZATION_DASHBOARDS_FLAGS,
  ORGANIZATION_DASHBOARDS_FLAGS_STALE_TIME_MS,
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
  const asks = enabled && organizationId !== void 0;
  const options = {
    enabled: asks,
    staleTime: ORGANIZATION_DASHBOARDS_FLAGS_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  };
  const [organizationAreaFlag, dashboardsFlag] = ORGANIZATION_DASHBOARDS_FLAGS;
  const reads = [
    analyticsApi.featureFlag.isEnabledForEachOrganization.useQuery(
      { flag: organizationAreaFlag, organizationIds },
      options,
    ),
    analyticsApi.featureFlag.isEnabledForEachOrganization.useQuery(
      { flag: dashboardsFlag, organizationIds },
      options,
    ),
  ];
  if (!asks || organizationId === void 0) return { isOpen: false, isLoading: false };
  // A failed read answers shut rather than "not yet", or a refused reader waits forever.
  const isLoading = reads.some((read) => read.data === void 0 && !read.isError);
  const isOn = (read: (typeof reads)[number]) =>
    read.data?.enabledByOrganizationId?.[organizationId] === true;
  return { isOpen: reads.every(isOn), isLoading };
}
