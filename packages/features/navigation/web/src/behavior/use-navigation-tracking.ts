import { useEffect, useRef } from "react";
import { useNavigationHost } from "../model/navigation-host";
import { writeLastVisitedProduct } from "../model/product-memory";
import { captureSettingsReturnPath } from "../model/resolve-settings-back-target";
import { productFromPathname } from "../model/products";

/**
 * The navigation write points, mounted once in InnerProviders: keep the
 * per-organization product memory current, and capture the page the
 * user left when entering Settings so its back entry can return there.
 *
 * Specs: specs/navigation/navigation-v2-product-memory.feature
 *        specs/navigation/navigation-v2-landing.feature
 */
export function useNavigationTracking(): void {
  const host = useNavigationHost();
  const pathname = host.pathname();
  const search = host.search();
  const previousRef = useRef<{ pathname: string; search: string } | null>(null);

  const organizationId = host.organization()?.id;

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { pathname, search };

    const product = productFromPathname(pathname);
    if (product && organizationId) {
      writeLastVisitedProduct({ organizationId, productId: product });
    }

    const enteringSettings = pathname === "/settings" || pathname.startsWith("/settings/");
    if (enteringSettings && previous) {
      // No-ops unless the previous page belonged to a product, so hopping
      // between settings pages never overwrites the capture.
      captureSettingsReturnPath({
        organizationId: organizationId ?? null,
        ...previous,
      });
    }
  }, [pathname, search, organizationId]);
}
