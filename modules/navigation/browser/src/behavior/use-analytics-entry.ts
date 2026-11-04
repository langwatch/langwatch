import { isAggregateProjectKind } from "@langwatch/project-contract";

import { useNavigationHost } from "../model/navigation-host.ts";
import { projectNavItems } from "../model/project-nav-items.ts";
import { useReachableProducts } from "./use-reachable-products.ts";

/**
 * Where the Analytics entry leads, for the sidebar and Quick Search alike. It waits for the
 * flag and the analytics:view grant (both read inside reachability), so its address never
 * flips under a click; aggregate projects have no Dashboards and stay on analytics.
 */
export function useAnalyticsEntry(): {
  path: string;
  leadsToDashboards: boolean;
  isSettled: boolean;
} {
  const host = useNavigationHost();
  const { reachableProducts, isLoading } = useReachableProducts();
  const leadsToDashboards =
    reachableProducts.includes("dashboards") && !isAggregateProjectKind(host.project()?.kind);

  return {
    path: leadsToDashboards ? projectNavItems.dashboards.path : projectNavItems.analytics.path,
    leadsToDashboards,
    isSettled: !isLoading,
  };
}
