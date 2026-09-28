/**
 * What a browser installs when it installs analytics: the drawers the
 * address bar opens (`?drawer.open=<name>`). Both wrappers were renamed
 * Drawer -> Dialog on this branch; the wire name did not change.
 */

import { defineWebModule } from "@langwatch/ui-kernel";
import { createElement } from "react";

import type { CustomGraphScreenMode } from "./ui/sections/analytics/custom-graph.screen.tsx";

/** The chart builder serves both its addresses; the mode is the route's own key. */
function customGraph(mode: CustomGraphScreenMode) {
  return async () => {
    const { default: CustomGraphScreen } =
      await import("./ui/sections/analytics/custom-graph.screen.tsx");

    return { default: () => createElement(CustomGraphScreen, { mode }) };
  };
}

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
    "pages/[project]/analytics/custom/index": {
      load: customGraph("new"),
    },
    "pages/[project]/analytics/custom/[id]": {
      load: customGraph("edit"),
    },
    // Dashboards v1, behind `release_dashboards`; each screen gates itself.
    "pages/[project]/dashboards/index": {
      load: () => import("./features/dashboards/ui/sections/dashboards-index.screen.tsx"),
    },
    "pages/[project]/dashboards/[dashboardId]": {
      load: () => import("./features/dashboards/ui/sections/dashboard-board.screen.tsx"),
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
  })
  /** The trace filter sidebar, lent to the evaluator's sample picker (§3.4 rule 7). */
  .withCapabilities({
    /** A custom graph over the project's traces, lent to modules that chart it (§3.4 rule 7). */
    customGraph: {
      load: async () => ({
        default: (await import("./ui/sections/custom-graph.tsx")).CustomGraph,
      }),
    },
    filterSidebar: {
      load: async () => ({
        default: (await import("./ui/sections/filters/filter-sidebar.tsx")).FilterSidebar,
      }),
    },
    /** The saved-dashboards list, lent to navigation's sidebar on dashboards pages. */
    savedDashboards: {
      load: async () => ({
        default: (await import("./features/dashboards/ui/sections/saved-dashboards-section.tsx"))
          .SavedDashboardsSection,
      }),
    },
  });
