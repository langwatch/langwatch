import { ORGANIZATION_DASHBOARDS_FLAGS } from "@langwatch/analytics-client";
import { CLIENT_FLAG_STALE_TIME_MS } from "@langwatch/feature-flag-client";

import type { ProductId } from "../model/products.ts";
import { navigationApi } from "./navigation-api.ts";

/**
 * How long a flag answer is trusted before it is asked again: 5 minutes,
 * restated here because `platform/app`'s `useFeatureFlag` (which used to
 * export it) no longer exists.
 */

const [ORGANIZATION_AREA_FLAG] = ORGANIZATION_DASHBOARDS_FLAGS;

/**
 * Product reachability per organization: the org switch needs the TARGET
 * org's reachable products — the only per-org gates resolvable from the
 * top bar (permissions stay page-enforced; product-switcher-navigation.feature).
 */
export function useProductFlagsByOrganization({
  organizationIds,
  enabled,
}: {
  organizationIds: string[];
  enabled: boolean;
}): {
  reachableProductsIn: (organizationId: string) => ProductId[];
  /** Whether the organization has the Dashboards area (ADR-002): both of its flags on. */
  hasOrganizationLibraryIn: (organizationId: string) => boolean;
  isLoading: boolean;
} {
  const queryOptions = {
    enabled,
    staleTime: CLIENT_FLAG_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  };
  const governanceByOrg = navigationApi.featureFlag.isEnabledForEachOrganization.useQuery(
    { flag: "release_ui_ai_governance_enabled", organizationIds },
    queryOptions,
  );
  const gatewayByOrg = navigationApi.featureFlag.isEnabledForEachOrganization.useQuery(
    { flag: "release_ui_ai_gateway_menu_enabled", organizationIds },
    queryOptions,
  );

  const dashboardsByOrg = navigationApi.featureFlag.isEnabledForEachOrganization.useQuery(
    { flag: "release_dashboards", organizationIds },
    queryOptions,
  );
  const organizationAreaByOrg = navigationApi.featureFlag.isEnabledForEachOrganization.useQuery(
    { flag: ORGANIZATION_AREA_FLAG, organizationIds },
    queryOptions,
  );
  const isOn = (read: typeof dashboardsByOrg, organizationId: string) =>
    read.data?.enabledByOrganizationId?.[organizationId] === true;

  return {
    reachableProductsIn: (organizationId: string) => {
      const products: ProductId[] = ["llm-ops"];
      if (governanceByOrg.data?.enabledByOrganizationId?.[organizationId]) {
        products.push("me", "governance");
      }
      if (dashboardsByOrg.data?.enabledByOrganizationId?.[organizationId]) {
        products.push("dashboards");
      }
      if (gatewayByOrg.data?.enabledByOrganizationId?.[organizationId]) {
        products.push("gateway");
      }
      return products;
    },
    hasOrganizationLibraryIn: (organizationId: string) =>
      isOn(dashboardsByOrg, organizationId) && isOn(organizationAreaByOrg, organizationId),
    isLoading:
      enabled &&
      [governanceByOrg, gatewayByOrg, dashboardsByOrg, organizationAreaByOrg].some(
        (read) => read.isLoading,
      ),
  };
}
