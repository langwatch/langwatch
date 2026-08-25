import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { writeLastVisitedProduct } from "./logic/productMemory";
import { captureSettingsReturnPath } from "./logic/resolveSettingsBackTarget";
import { productFromPathname } from "./products";
import { useNavigationMode } from "./useNavigationMode";

/**
 * The navigation-v2 write points, mounted once in InnerProviders: keep
 * the per-organization product memory current, and capture the page the
 * user left when entering Settings so its back entry can return there.
 * Both only run in the new modes; legacy devices write nothing.
 *
 * Specs: specs/navigation/navigation-v2-product-memory.feature
 *        specs/navigation/navigation-v2-landing.feature
 */
export function useNavigationV2Tracking(): void {
  const location = useLocation();
  const resolution = useNavigationMode();
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const previousRef = useRef<{ pathname: string; search: string } | null>(null);

  const organizationId = organization?.id;
  const isV2 = resolution.status === "ready" && resolution.mode !== "legacy";

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = {
      pathname: location.pathname,
      search: location.search,
    };
    if (!isV2) return;

    const product = productFromPathname(location.pathname);
    if (product && organizationId) {
      writeLastVisitedProduct({ organizationId, productId: product });
    }

    const enteringSettings =
      location.pathname === "/settings" || location.pathname.startsWith("/settings/");
    if (enteringSettings && previous) {
      // No-ops unless the previous page belonged to a product, so hopping
      // between settings pages never overwrites the capture.
      captureSettingsReturnPath({
        organizationId: organizationId ?? null,
        ...previous,
      });
    }
  }, [location.pathname, location.search, isV2, organizationId]);
}
