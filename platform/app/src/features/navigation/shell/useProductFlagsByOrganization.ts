import { CLIENT_FLAG_STALE_TIME_MS } from "~/hooks/useFeatureFlag";
import { api } from "~/utils/api";
import type { ProductId } from "../products";

/**
 * Product reachability per organization. The organization switch needs the
 * TARGET organization's reachable products, and these flags are the only
 * per-organization gates resolvable from the top bar (permissions stay
 * page-enforced). Returns a lookup for one organization id.
 *
 * Spec: specs/navigation/product-switcher-navigation.feature
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
  const governanceByOrg = api.featureFlag.isEnabledForEachOrganization.useQuery(
    { flag: "release_ui_ai_governance_enabled", organizationIds },
    queryOptions,
  );
  const gatewayByOrg = api.featureFlag.isEnabledForEachOrganization.useQuery(
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
