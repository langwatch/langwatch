/**
 * What a browser installs when it installs analytics: the drawers the
 * address bar opens (`?drawer.open=<name>`). Both wrappers were renamed
 * Drawer -> Dialog on this branch; the wire name did not change.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const analyticsWeb = defineWebModule("analytics")
  .withHosts({
    requires: ["AnalyticsHostApi"],
    mounts: { AnalyticsHostApi: { load: () => import("./behavior/analytics-host-mount.tsx") } },
  })
  // These screens qualify for `@langwatch/dashboard-process` under the
  // transport-ownership rule, but stay here under its own type exception:
  // moving would duplicate the 1,700-line `CustomGraph` renderer they share.
  .withScreens({
    "pages/[project]/analytics/index": {
      load: () => import("./ui/sections/analytics/analytics-overview.screen.tsx"),
    },
    "pages/[project]/analytics/evaluations": {
      load: () => import("./ui/sections/analytics/analytics-evaluations.screen.tsx"),
    },
    "pages/[project]/analytics/metrics": {
      load: () => import("./ui/sections/analytics/analytics-metrics.screen.tsx"),
    },
    "pages/[project]/analytics/reports": {
      load: () => import("./ui/sections/analytics/analytics-reports.screen.tsx"),
    },
    "pages/[project]/analytics/topics": {
      load: () => import("./ui/sections/analytics/analytics-topics.screen.tsx"),
    },
    "pages/[project]/analytics/users": {
      load: () => import("./ui/sections/analytics/analytics-users.screen.tsx"),
    },
    "pages/[project]/analytics/query": {
      load: () => import("./ui/sections/analytics/analytics-query.screen.tsx"),
    },
    "pages/[project]/analytics/v2": {
      load: () => import("./ui/sections/analytics/analytics-v2.screen.tsx"),
    },
    "pages/[project]/analytics/custom/[id]": {
      load: () => import("./ui/sections/analytics/custom-graph.screen.tsx"),
    },
  })
  .withDrawers({
    dashboardName: {
      load: async () => ({
        default: (await import("./ui/sections/dashboard-name-dialog.tsx")).DashboardNameDialog,
      }),
    },
    seriesFilters: {
      load: async () => ({
        default: (await import("./ui/sections/series-filters-dialog.tsx")).SeriesFiltersDialog,
      }),
    },
  });
