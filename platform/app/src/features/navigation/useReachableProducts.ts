import { useMemo } from "react";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { FrontendFeatureFlag } from "~/server/featureFlag/frontendFeatureFlags";
import { NOT_TARGETED } from "~/server/featureFlag/targeting";
import { PRODUCTS, type ProductId } from "./products";

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
  const {
    project,
    organization,
    hasPermission,
    isLoading: isOrganizationLoading,
  } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  const isQueryEnabled = enabled && !!organization?.id;
  const gatewayFlag = useFeatureFlag("release_ui_ai_gateway_menu_enabled", {
    projectId: project?.id ?? NOT_TARGETED,
    organizationId: organization?.id,
    enabled: isQueryEnabled,
  });
  const governanceFlag = useFeatureFlag("release_ui_ai_governance_enabled", {
    projectId: project?.id ?? NOT_TARGETED,
    organizationId: organization?.id,
    enabled: isQueryEnabled,
  });

  const flagValues: Partial<Record<FrontendFeatureFlag, boolean>> = {
    release_ui_ai_gateway_menu_enabled: gatewayFlag.enabled,
    release_ui_ai_governance_enabled: governanceFlag.enabled,
  };

  const reachableIds = enabled
    ? PRODUCTS.filter((product) =>
        product.gates.every((gate) => {
          if (gate.flag !== undefined && !flagValues[gate.flag]) return false;
          if (
            gate.permission !== undefined &&
            !hasPermission(gate.permission)
          ) {
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
      ? isOrganizationLoading ||
        gatewayFlag.isLoading ||
        governanceFlag.isLoading
      : false,
  };
}
