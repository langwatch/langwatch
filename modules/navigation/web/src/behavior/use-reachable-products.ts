import { useMemo } from "react";
import type { FrontendFeatureFlag } from "@langwatch/feature-flag-contract";
import { useNavigationHost } from "../model/navigation-host.ts";
import { PRODUCTS, type ProductId } from "../model/products.ts";

/** Products user can open; evaluated against flags/permissions; isLoading covers queries */
export function useReachableProducts({
  enabled = true,
}: {
  enabled?: boolean;
} = {}): {
  reachableProducts: ProductId[];
  isLoading: boolean;
} {
  const host = useNavigationHost();
  const isOrganizationLoading = host.isLoading();
  const hasPermission = (permission: string) => host.hasPermission(permission);

  // A disabled caller asks for nothing. The platform hook expressed that by
  // passing `enabled: false` down to the flag QUERIES so they never ran; the
  // host answers flags now, so the same property is "do not ask".
  const NOT_ASKED = { enabled: false, isLoading: false };
  const gatewayFlag = enabled ? host.featureFlag("release_ui_ai_gateway_menu_enabled") : NOT_ASKED;
  const governanceFlag = enabled ? host.featureFlag("release_ui_ai_governance_enabled") : NOT_ASKED;

  const flagValues: Partial<Record<FrontendFeatureFlag, boolean>> = {
    release_ui_ai_gateway_menu_enabled: gatewayFlag.enabled,
    release_ui_ai_governance_enabled: governanceFlag.enabled,
  };

  const reachableIds = enabled
    ? PRODUCTS.filter((product) =>
        product.gates.every((gate) => {
          if (gate.flag !== undefined && !flagValues[gate.flag]) return false;
          if (gate.permission !== undefined && !hasPermission(gate.permission)) {
            return false;
          }
          return true;
        }),
      ).map((product) => product.id)
    : [];

  // A stable identity for a stable answer: consumers put this list in
  // effect dependencies (the "/" landing), so a fresh array every render
  // would re-fire those effects into a render loop.
  const reachableKey = reachableIds.join(",");
  const reachableProducts = useMemo(
    () => (reachableKey === "" ? [] : (reachableKey.split(",") as ProductId[])),
    [reachableKey],
  );

  return {
    reachableProducts,
    isLoading: enabled
      ? isOrganizationLoading || gatewayFlag.isLoading || governanceFlag.isLoading
      : false,
  };
}
