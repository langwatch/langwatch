import {
  ORGANIZATION_DASHBOARDS_FLAG,
  ORGANIZATION_DASHBOARDS_FLAGS_STALE_TIME_MS,
  organizationDashboardsArea,
  type OrganizationDashboardsArea,
} from "@langwatch/analytics-client";

import { useNavigationHost } from "../model/navigation-host.ts";
import { isOrganizationDashboardsPath } from "../model/products.ts";
import { navigationApi } from "./navigation-api.ts";

/**
 * The organization's Dashboards flag, asked of the organization: "open" when the library
 * exists, "closed" with Dashboards off. Asks only when enabled.
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
  const dashboards = navigationApi.featureFlag.isEnabledForEachOrganization.useQuery(
    { flag: ORGANIZATION_DASHBOARDS_FLAG, organizationIds },
    options,
  );
  return organizationDashboardsArea({ organizationId, dashboards });
}

/**
 * Whether the organization's Dashboards area (the library and the pages under `/dashboards/`)
 * opens at this address, its flag asked of the organization; "elsewhere" asks nothing.
 */
export function useOrganizationDashboardsArea(): OrganizationDashboardsArea | "elsewhere" {
  const isLibrary = isOrganizationDashboardsPath(useNavigationHost().pathname());
  const area = useOrganizationDashboardsFlags({ enabled: isLibrary });
  return isLibrary ? area : "elsewhere";
}
