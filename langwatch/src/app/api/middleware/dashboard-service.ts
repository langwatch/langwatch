import type { MiddlewareHandler } from "hono";

import { prisma } from "~/server/db";
import { DashboardService } from "~/server/dashboards/dashboard.service";

export type DashboardServiceMiddlewareVariables = {
  dashboardService: DashboardService;
};

export const dashboardServiceMiddleware: MiddlewareHandler = async (
  c,
  next,
) => {
  c.set("dashboardService", DashboardService.create(prisma));
  await next();
};
