/**
 * Binds the feature's declared procedures to this process's execution path.
 *
 * `savedWorkbenchCharts` is mounted here rather than with analytics because
 * the subject belongs to Dashboard, even though the namespace a member reaches
 * it through is `analytics.savedWorkbenchCharts`.
 */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { DashboardApi } from "@langwatch/dashboard-contract";
import {
  dashboardTrpcTransport,
  graphTrpcTransport,
  savedViewTrpcTransport,
  savedWorkbenchChartTrpcTransport,
} from "@langwatch/dashboard-server";

/** The one slice of the process context these four namespaces read. */
export interface DashboardHostContext {
  app: Readonly<{ dashboard: DashboardApi }>;
}

/** Mounts `dashboards.*` on the app process's tRPC root. */
export function createDashboardTrpcRouter<TContext extends DashboardHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(dashboardTrpcTransport, (ctx) => ctx.app.dashboard);
}

/** Mounts `graphs.*` on the app process's tRPC root. */
export function createGraphTrpcRouter<TContext extends DashboardHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(graphTrpcTransport, (ctx) => ctx.app.dashboard);
}

/** Mounts `savedViews.*` on the app process's tRPC root. */
export function createSavedViewTrpcRouter<TContext extends DashboardHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(savedViewTrpcTransport, (ctx) => ctx.app.dashboard);
}

/** Mounts the saved-workbench-chart surface on the app process's tRPC root. */
export function createSavedWorkbenchChartTrpcRouter<TContext extends DashboardHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(savedWorkbenchChartTrpcTransport, (ctx) => ctx.app.dashboard);
}
