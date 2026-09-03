import { navigationApi } from "./navigation-api";
import type { ProductId } from "../model/products";

/**
 * How long a flag answer is trusted before it is asked again.
 *
 * `platform/app`'s `useFeatureFlag` exported this and the hook read it from
 * there; five minutes, restated here because that module no longer exists.
 */
const CLIENT_FLAG_STALE_TIME_MS = 5 * 60_000;

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
