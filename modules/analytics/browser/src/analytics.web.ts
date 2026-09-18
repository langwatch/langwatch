/**
 * What a browser installs when it installs analytics: the drawers the
 * address bar opens (`?drawer.open=<name>`). Both wrappers were renamed
 * Drawer -> Dialog on this branch; the wire name did not change.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const analyticsWeb = defineWebModule("analytics").withDrawers({
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
