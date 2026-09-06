import type { MiddlewareHandler } from "hono";
import { DashboardService } from "~/server/dashboards/dashboard.service";
import { prisma } from "~/server/db";

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
