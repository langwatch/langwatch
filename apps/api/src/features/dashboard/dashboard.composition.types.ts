/**
 * Kept apart from the composition so importing the router or app type never
 * pulls in the installer.
 */
import type { DashboardApi } from "@langwatch/dashboard-contract";

import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type {
  createDashboardTrpcRouter,
  createGraphTrpcRouter,
  createSavedViewTrpcRouter,
  createSavedWorkbenchChartTrpcRouter,
} from "./dashboard-trpc.mount.ts";

/** The four namespaces and the `ctx.app.dashboard` slice they read. */
export type ComposedDashboardFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    dashboards: ReturnType<typeof createDashboardTrpcRouter<ApiTrpcContext>>;
    graphs: ReturnType<typeof createGraphTrpcRouter<ApiTrpcContext>>;
    savedViews: ReturnType<typeof createSavedViewTrpcRouter<ApiTrpcContext>>;
    savedWorkbenchCharts: ReturnType<typeof createSavedWorkbenchChartTrpcRouter<ApiTrpcContext>>;
  };
  /** For `ctx.app.dashboard`, which the two REST families also read. */
  app: DashboardApi;
  /**
   * The lazy service entry the process's REST list takes for this feature. A
   * provider rather than the application itself, so building the list never
   * forces construction — the OpenAPI generator builds it with none.
   */
  restServices: Readonly<{ dashboard: () => DashboardApi }>;
}>;
