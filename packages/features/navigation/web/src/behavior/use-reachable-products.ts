import { useMemo } from "react";
import type { FrontendFeatureFlag } from "@langwatch/feature-flag-contract";
import { useNavigationHost } from "../model/navigation-host";
import { PRODUCTS, type ProductId } from "../model/products";

/**
 * Which products the current user can open right now: every access gate
 * in the registry evaluated against the live flags and permissions.
 * `isLoading` covers the flag round-trips so landing decisions can wait
 * instead of resolving against a half-evaluated list.
 *
 * The product registry belongs to the new navigation modes, so a caller
 * that also runs in legacy mode passes `enabled: false` there. The flag
 * queries then never run and the legacy path keeps its request count.
 */
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

  // A legacy-mode caller asks for nothing. The platform hook expressed that by
  // passing `enabled: false` down to the flag QUERIES so they never ran; the
  // host answers flags now, so the same property is "do not ask".
  const NOT_ASKED = { enabled: false, isLoading: false };
  const gatewayFlag = enabled
    ? host.featureFlag("release_ui_ai_gateway_menu_enabled")
    : NOT_ASKED;
  const governanceFlag = enabled
    ? host.featureFlag("release_ui_ai_governance_enabled")
    : NOT_ASKED;

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
