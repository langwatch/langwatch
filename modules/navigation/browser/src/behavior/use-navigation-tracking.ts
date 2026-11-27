import { useEffect, useRef } from "react";

import {
  honourDashboardsSidebarHint,
  readDashboardsSidebarHint,
  writeDashboardsSidebarHint,
} from "../model/dashboards-sidebar-hint.ts";
import { useNavigationHost } from "../model/navigation-host.ts";
import { writeLastVisitedProduct } from "../model/product-memory.ts";
import { type ProductId, productFromPathname } from "../model/products.ts";
import { captureSettingsReturnPath } from "../model/resolve-settings-back-target.ts";
import { useReachableProducts } from "./use-reachable-products.ts";

/** Remembers the sidebar drawn, not the address, and keeps the Dashboards sidebar hint current. */
function trackProduct({
  product,
  organizationId,
  projectId,
  reachableProducts,
}: {
  product: ProductId;
  organizationId: string | undefined;
  projectId: string | undefined;
  reachableProducts: readonly ProductId[];
}): void {
  const hint = honourDashboardsSidebarHint({
    hint: readDashboardsSidebarHint({ projectId }),
    reachableProducts,
  });
  const shownProduct = product === "dashboards" && hint === "llm-ops" ? "llm-ops" : product;
  if (organizationId) writeLastVisitedProduct({ organizationId, productId: shownProduct });
  // Dashboards pages keep the hint they arrived with; every other product page resets it.
  if (product !== "dashboards") {
    writeDashboardsSidebarHint({
      hint: product === "llm-ops" ? "llm-ops" : "dashboards",
      projectId,
    });
  }
}

/**
 * The navigation write points, mounted once in InnerProviders: keep the
 * per-organization product memory current, and capture the page left
 * when entering Settings so its back entry can return there.
 */
export function useNavigationTracking(): void {
  const host = useNavigationHost();
  const pathname = host.pathname();
  const search = host.search();
  const previousRef = useRef<{ pathname: string; search: string } | null>(null);

  const organizationId = host.organization()?.id;
  const projectId = host.project()?.id;
  const { reachableProducts } = useReachableProducts();

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { pathname, search };

    const product = productFromPathname(pathname);
    if (product) trackProduct({ product, organizationId, projectId, reachableProducts });

    const enteringSettings = pathname === "/settings" || pathname.startsWith("/settings/");
    if (enteringSettings && previous) {
      // No-ops unless the previous page belonged to a product, so hopping
      // between settings pages never overwrites the capture.
      captureSettingsReturnPath({
        organizationId: organizationId ?? null,
        ...previous,
      });
    }
  }, [pathname, search, organizationId, projectId, reachableProducts]);
}
