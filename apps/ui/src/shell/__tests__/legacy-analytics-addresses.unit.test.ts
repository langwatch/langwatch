/**
 * Switching analytics over to Dashboards moves the entry, never the old addresses.
 * @see modules/dashboard/specs/dashboards-v1.feature
 */
import { describe, expect, it } from "vitest";

import { uiLegacyRedirectRoutes, uiRouteDescriptors, uiRouteTable } from "../ui-route-table";

const isLegacyAnalyticsPath = (path: string | undefined): boolean =>
  path === "/:project/analytics" || (path?.startsWith("/:project/analytics/") ?? false);

describe("given the legacy analytics addresses", () => {
  /** @scenario "AC3e An old analytics address opens its own page" */
  it("serves each one as its own page and redirects none of them", () => {
    const analyticsRoutes = [...uiRouteDescriptors(uiRouteTable), ...uiLegacyRedirectRoutes].filter(
      (descriptor) => isLegacyAnalyticsPath(descriptor.path),
    );

    expect(analyticsRoutes.map((descriptor) => descriptor.path)).toContain("/:project/analytics");
    for (const descriptor of analyticsRoutes) {
      expect(descriptor).not.toHaveProperty("redirect");
      expect(descriptor).toHaveProperty("page");
    }
  });
});
