import type { ProductId } from "../model/products.ts";
import { navigationApi } from "./navigation-api.ts";

/**
 * How long a flag answer is trusted before it is asked again: 5 minutes,
 * restated here because `platform/app`'s `useFeatureFlag` (which used to
 * export it) no longer exists.
 */
const CLIENT_FLAG_STALE_TIME_MS = 5 * 60_000;

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

  return {
    reachableProductsIn: (organizationId: string) => {
      const products: ProductId[] = ["llm-ops"];
      if (governanceByOrg.data?.enabledByOrganizationId?.[organizationId]) {
        products.push("me", "governance");
      }
      if (gatewayByOrg.data?.enabledByOrganizationId?.[organizationId]) {
        products.push("gateway");
      }
      return products;
    },
    isLoading: enabled && (governanceByOrg.isLoading || gatewayByOrg.isLoading),
  };
}
