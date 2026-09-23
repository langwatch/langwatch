import { prismaRepositories } from "@langwatch/prisma-client";

import { PrismaDashboardWidgetRepository } from "./prisma.dashboard-widget.repository.ts";
import { PrismaDashboardRepository } from "./prisma.dashboard.repository.ts";
import { PrismaSavedViewRepository } from "./prisma.saved-view.repository.ts";

export const PostgresDashboardRepositories = prismaRepositories({
  dashboards: PrismaDashboardRepository,
  dashboardWidgets: PrismaDashboardWidgetRepository,
  savedViews: PrismaSavedViewRepository,
});
