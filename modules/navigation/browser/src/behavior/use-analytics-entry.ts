import { isAggregateProjectKind } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";

import { useNavigationHost } from "../model/navigation-host.ts";
import { organizationKnewOldAnalytics } from "../model/old-analytics-entry.ts";
import { projectNavItems } from "../model/project-nav-items.ts";
import { useReachableProducts } from "./use-reachable-products.ts";

/**
 * Where the Analytics entry leads, for the sidebar and Quick Search alike; it waits for the
 * flag and the grant so its address never flips under a click. Aggregates stay on analytics.
 * Not offered where it leads to Dashboards in an organization under 21 days old.
 */
export function useAnalyticsEntry(): {
  path: string;
  leadsToDashboards: boolean;
  isSettled: boolean;
  isOffered: boolean;
} {
  const host = useNavigationHost();
  const { reachableProducts, isLoading } = useReachableProducts();
  const leadsToDashboards =
    reachableProducts.includes("dashboards") && !isAggregateProjectKind(host.project()?.kind);

  return {
    path: leadsToDashboards ? projectNavItems.dashboards.path : projectNavItems.analytics.path,
    leadsToDashboards,
    isSettled: !isLoading,
    isOffered:
      !leadsToDashboards ||
      organizationKnewOldAnalytics({
        createdAt: host.organization()?.createdAt,
        now: nowInstant(),
      }),
  };
}
