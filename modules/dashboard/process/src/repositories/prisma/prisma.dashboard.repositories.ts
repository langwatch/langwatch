import { prismaRepositories } from "@langwatch/prisma-client";

import { PrismaBoardRepository } from "./prisma.board.repository.ts";
import { PrismaDashboardWidgetRepository } from "./prisma.dashboard-widget.repository.ts";
import { PrismaDashboardRepository } from "./prisma.dashboard.repository.ts";
import { PrismaSavedViewRepository } from "./prisma.saved-view.repository.ts";

export const PostgresDashboardRepositories = prismaRepositories({
  boards: PrismaBoardRepository,
  dashboards: PrismaDashboardRepository,
  dashboardWidgets: PrismaDashboardWidgetRepository,
  savedViews: PrismaSavedViewRepository,
});
