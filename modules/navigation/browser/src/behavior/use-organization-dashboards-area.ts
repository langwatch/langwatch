import {
  ORGANIZATION_DASHBOARDS_FLAGS,
  ORGANIZATION_DASHBOARDS_FLAGS_STALE_TIME_MS,
  organizationDashboardsArea,
  type OrganizationDashboardsArea,
} from "@langwatch/analytics-client";

import { useNavigationHost } from "../model/navigation-host.ts";
import { isOrganizationDashboardsPath } from "../model/products.ts";
import { navigationApi } from "./navigation-api.ts";

/**
 * The organization's Dashboards flags, both asked of the organization: "open" when the library
 * exists, "legacy" with its own flag off, "closed" with Dashboards off. Asks only when enabled.
 */
export function useOrganizationDashboardsFlags({
  enabled,
}: {
  enabled: boolean;
}): OrganizationDashboardsArea {
  const organizationId = useNavigationHost().organization()?.id;
  const organizationIds = organizationId === void 0 ? [] : [organizationId];
  const options = {
    enabled: enabled && organizationId !== void 0,
    staleTime: ORGANIZATION_DASHBOARDS_FLAGS_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  };
  const [organizationAreaFlag, dashboardsFlag] = ORGANIZATION_DASHBOARDS_FLAGS;
  const organizationArea = navigationApi.featureFlag.isEnabledForEachOrganization.useQuery(
    { flag: organizationAreaFlag, organizationIds },
    options,
  );
  const dashboards = navigationApi.featureFlag.isEnabledForEachOrganization.useQuery(
    { flag: dashboardsFlag, organizationIds },
    options,
  );
  return organizationDashboardsArea({ organizationId, organizationArea, dashboards });
}

/**
 * Whether the organization's Dashboards area (the library and the pages under `/dashboards/`)
 * opens at this address, its flags asked of the organization; "elsewhere" asks nothing.
 */
export function useOrganizationDashboardsArea(): OrganizationDashboardsArea | "elsewhere" {
  const isLibrary = isOrganizationDashboardsPath(useNavigationHost().pathname());
  const area = useOrganizationDashboardsFlags({ enabled: isLibrary });
  return isLibrary ? area : "elsewhere";
}
