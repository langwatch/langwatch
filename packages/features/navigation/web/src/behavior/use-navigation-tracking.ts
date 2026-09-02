import { useEffect, useRef } from "react";
import { useNavigationHost } from "../model/navigation-host";
import { writeLastVisitedProduct } from "../model/product-memory";
import { captureSettingsReturnPath } from "../model/resolve-settings-back-target";
import { productFromPathname } from "../model/products";
import { useNavigationMode } from "./use-navigation-mode";

/**
 * The navigation-v2 write points, mounted once in InnerProviders: keep
 * the per-organization product memory current, and capture the page the
 * user left when entering Settings so its back entry can return there.
 * Both only run in the new modes; legacy devices write nothing.
 *
 * Specs: specs/navigation/navigation-v2-product-memory.feature
 *        specs/navigation/navigation-v2-landing.feature
 */
export function useNavigationTracking(): void {
  const host = useNavigationHost();
  const resolution = useNavigationMode();
  const pathname = host.pathname();
  const search = host.search();
  const previousRef = useRef<{ pathname: string; search: string } | null>(null);

  const organizationId = host.organization()?.id;
  const isV2 = resolution.status === "ready" && resolution.mode !== "legacy";

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { pathname, search };
    if (!isV2) return;

    const product = productFromPathname(pathname);
    if (product && organizationId) {
      writeLastVisitedProduct({ organizationId, productId: product });
    }

    const enteringSettings =
      pathname === "/settings" || pathname.startsWith("/settings/");
    if (enteringSettings && previous) {
      // No-ops unless the previous page belonged to a product, so hopping
      // between settings pages never overwrites the capture.
      captureSettingsReturnPath({
        organizationId: organizationId ?? null,
        ...previous,
      });
    }
  }, [pathname, search, isV2, organizationId]);
}
