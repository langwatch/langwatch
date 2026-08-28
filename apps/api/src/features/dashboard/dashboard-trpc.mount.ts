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
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { appTrpcPolicy, type AppTrpcPolicyMiddlewares } from "../../app-trpc/app-trpc.policy";

type DashboardMount<
  TContext extends DashboardTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
}>;

/** Mounts `dashboards.*` on the app process's tRPC root. */
export function createDashboardTrpcRouter<
  TContext extends DashboardTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: DashboardMount<TContext, TOptions, TRoot>) {
  return DashboardTrpcApi.create(mount.root, {
    protected: mount.protectedProcedure,
    policy: appTrpcPolicy(mount.middlewares),
  });
}

type GraphMount<
  TContext extends GraphTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TFilterField extends string,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  /** Forwarded untouched: both the catalogue and the redaction are the host's. */
  ports: GraphTrpcPorts<TFilterField>;
}>;

/** Mounts `graphs.*` on the app process's tRPC root. */
export function createGraphTrpcRouter<
  TContext extends GraphTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TFilterField extends string,
>(mount: GraphMount<TContext, TOptions, TRoot, TFilterField>) {
  return GraphTrpcApi.create(
    mount.root,
    { protected: mount.protectedProcedure, policy: appTrpcPolicy(mount.middlewares) },
    mount.ports,
  );
}

type SavedViewMount<
  TContext extends SavedViewTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TView,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  /**
   * Forwarded untouched. `TView` is inferred from the host's own service, so
   * the rows reach the client with the shape they have always had rather than
   * a narrowed copy of it.
   */
  ports: SavedViewTrpcPorts<TView>;
}>;

/** Mounts `savedViews.*` on the app process's tRPC root. */
export function createSavedViewTrpcRouter<
  TContext extends SavedViewTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TView,
>(mount: SavedViewMount<TContext, TOptions, TRoot, TView>) {
  return SavedViewTrpcApi.create(
    mount.root,
    { protected: mount.protectedProcedure, policy: appTrpcPolicy(mount.middlewares) },
    mount.ports,
  );
}

type SavedWorkbenchChartMount<
  TContext extends SavedWorkbenchChartTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  /**
   * Forwarded untouched. The caller resolution hashes the project's
   * LangWatchQL secret into the tenant capability a chart runs as, so it stays
   * the host's and never leaves the calling procedure.
   */
  ports: SavedWorkbenchChartTrpcPorts;
}>;

/** Mounts the saved-workbench-chart surface on the app process's tRPC root. */
export function createSavedWorkbenchChartTrpcRouter<
  TContext extends SavedWorkbenchChartTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: SavedWorkbenchChartMount<TContext, TOptions, TRoot>) {
  return SavedWorkbenchChartTrpcApi.create(
    mount.root,
    { protected: mount.protectedProcedure, policy: appTrpcPolicy(mount.middlewares) },
    mount.ports,
  );
}
