/**
 * App-process transport mounts for the entitlement vertical: which plan an
 * organization is on, and what it has used against that plan's allowance.
 *
 * Behaviour is package-owned (`@langwatch/entitlement-server`); this supplies
 * the process's root, authenticated procedure, policy chain, and — for the
 * usage surface — the deployment's usage reader and approaching-limit
 * notifier, both composed over its billing store.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import {
  LimitsTrpcApi,
  PlanTrpcApi,
  type LimitsTrpcContext,
  type LimitsTrpcPorts,
  type PlanTrpcContext,
} from "@langwatch/entitlement-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `plan.*` on the app process's tRPC root. */
export function createPlanTrpcRouter<
  TContext extends PlanTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot>) {
  return PlanTrpcApi.create(mount.root, createTrpcApiService(mount));
}

/** Mounts `limits.*` on the app process's tRPC root. */
export function createLimitsTrpcRouter<
  TContext extends LimitsTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TPorts extends LimitsTrpcPorts,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<TPorts>) {
  return LimitsTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}
