/**
 * App-process transport mounts for the dashboard vertical.
 *
 * Behaviour is package-owned (`@langwatch/dashboard-server`); these supply the
 * process's tRPC root, its authenticated procedure, its policy chain, and the
 * host capabilities dashboard does not own — the filter-field catalogue a
 * stored graph is read back against, the automation secret redaction, the
 * saved-view lifecycle, and the LangWatchQL rollout gate and caller resolution
 * a saved workbench chart is admitted and executed under.
 *
 * `saved-workbench-chart` is mounted here rather than with analytics because
 * the subject belongs to Dashboard, even though the namespace a member reaches
 * it through is `analytics.savedWorkbenchCharts`.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import {
  DashboardTrpcApi,
  GraphTrpcApi,
  SavedViewTrpcApi,
  SavedWorkbenchChartTrpcApi,
  type DashboardTrpcContext,
  type GraphTrpcContext,
  type GraphTrpcPorts,
  type SavedViewTrpcContext,
  type SavedViewTrpcPorts,
  type SavedWorkbenchChartTrpcContext,
  type SavedWorkbenchChartTrpcPorts,
} from "@langwatch/dashboard-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `dashboards.*` on the app process's tRPC root. */
export function createDashboardTrpcRouter<
  TContext extends DashboardTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot>) {
  return DashboardTrpcApi.create(mount.root, createTrpcApiService(mount));
}

/**
 * Mounts `graphs.*` on the app process's tRPC root.
 *
 * The ports are forwarded untouched: both the catalogue and the redaction are
 * the host's.
 */
export function createGraphTrpcRouter<
  TContext extends GraphTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TFilterField extends string,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<GraphTrpcPorts<TFilterField>>) {
  return GraphTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}

/**
 * Mounts `savedViews.*` on the app process's tRPC root.
 *
 * The ports are forwarded untouched. `TView` is inferred from the host's own
 * service, so the rows reach the client with the shape they have always had
 * rather than a narrowed copy of it.
 */
export function createSavedViewTrpcRouter<
  TContext extends SavedViewTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TView,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<SavedViewTrpcPorts<TView>>) {
  return SavedViewTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}

/**
 * Mounts the saved-workbench-chart surface on the app process's tRPC root.
 *
 * The ports are forwarded untouched. The caller resolution hashes the project's
 * LangWatchQL secret into the tenant capability a chart runs as, so it stays
 * the host's and never leaves the calling procedure.
 */
export function createSavedWorkbenchChartTrpcRouter<
  TContext extends SavedWorkbenchChartTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<SavedWorkbenchChartTrpcPorts>) {
  return SavedWorkbenchChartTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}
