import type { MiddlewareHandler } from "hono";
import type { DashboardService } from "@langwatch/dashboard-contract";

export type DashboardServiceMiddlewareVariables = {
  dashboardService: DashboardService;
};

export const dashboardServiceMiddleware: MiddlewareHandler = async (
  c,
  next,
) => {
  c.set("dashboardService", c.app.dashboard);
  await next();
};
