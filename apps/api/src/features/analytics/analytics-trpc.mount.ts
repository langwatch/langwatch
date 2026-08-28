/**
 * App-process transport mounts for the analytics vertical.
 *
 * Behaviour is package-owned (`@langwatch/analytics-server`); these supply the
 * process's tRPC root, its authenticated procedure, its policy chain, and the
 * host capabilities analytics does not own — the shared analytics input
 * schemas, the filter catalogue, the LangWatchQL rollout gate and the caller
 * resolution the restricted executor runs as.
 *
 * The saved workbench charts that sit alongside these under the same
 * `analytics.*` namespace belong to `@langwatch/dashboard-server`, so their
 * mount is in `../dashboard/dashboard-trpc.mount`, not here.
 */
import type {
  AnalyticsReadInput,
  AnalyticsTimeseriesInput,
} from "@langwatch/analytics-contract";
import {
  AnalyticsTrpcApi,
  LangWatchQLTrpcApi,
  type AnalyticsTrpcContext,
  type AnalyticsTrpcPorts,
  type LangWatchQLTrpcContext,
  type LangWatchQLTrpcPorts,
} from "@langwatch/analytics-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { appTrpcPolicy, type AppTrpcPolicyMiddlewares } from "../../app-trpc/app-trpc.policy";

type AnalyticsMount<
  TContext extends AnalyticsTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TTimeseriesInput extends AnalyticsTimeseriesInput,
  TReadInput extends AnalyticsReadInput,
  TFilterField extends string,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  /**
   * Forwarded untouched. The two schemas are the host's because the same
   * shapes are the REST analytics body and the traces filter input: one
   * definition, in the host, is what keeps those surfaces from drifting.
   */
  ports: AnalyticsTrpcPorts<TTimeseriesInput, TReadInput, TFilterField>;
}>;

/** Mounts the `analytics.*` reads on the app process's tRPC root. */
export function createAnalyticsTrpcRouter<
  TContext extends AnalyticsTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TTimeseriesInput extends AnalyticsTimeseriesInput,
  TReadInput extends AnalyticsReadInput,
  TFilterField extends string,
>(
  mount: AnalyticsMount<
    TContext,
    TOptions,
    TRoot,
    TTimeseriesInput,
    TReadInput,
    TFilterField
  >,
) {
  return AnalyticsTrpcApi.create(
    mount.root,
    { protected: mount.protectedProcedure, policy: appTrpcPolicy(mount.middlewares) },
    mount.ports,
  );
}

type LangWatchQLMount<
  TContext extends LangWatchQLTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  /**
   * Forwarded untouched. The rollout gate is chained by the feature AFTER the
   * permission check, so a caller is placed by RBAC first and gated by the
   * experiment second.
   */
  ports: LangWatchQLTrpcPorts;
}>;

/** Mounts the LangWatchQL workbench surface on the app process's tRPC root. */
export function createLangWatchQLTrpcRouter<
  TContext extends LangWatchQLTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: LangWatchQLMount<TContext, TOptions, TRoot>) {
  return LangWatchQLTrpcApi.create(
    mount.root,
    { protected: mount.protectedProcedure, policy: appTrpcPolicy(mount.middlewares) },
    mount.ports,
  );
}
