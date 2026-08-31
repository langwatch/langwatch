/**
 * App-process transport mounts for the project vertical's two page surfaces.
 *
 * Behaviour is package-owned (`@langwatch/project-server`); these supply the
 * process's root, authenticated procedure, policy chain, and the two readers
 * the project does not own — recent activity, which walks the process's audit
 * trail and hydrates each entity it finds there, and the setup rollup, which
 * fans out across the nine verticals holding the evidence.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import {
  HomeTrpcApi,
  IntegrationsChecksTrpcApi,
  type HomeTrpcContext,
  type HomeTrpcPorts,
  type IntegrationsChecksTrpcContext,
  type IntegrationsChecksTrpcPorts,
} from "@langwatch/project-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `home.*` on the app process's tRPC root. */
export function createHomeTrpcRouter<
  TContext extends HomeTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<HomeTrpcPorts>) {
  return HomeTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}

/**
 * Mounts `integrationsChecks.*` on the app process's tRPC root.
 *
 * The port is forwarded untouched, and `TCheckStatus` is inferred from the
 * process's own reader, so the checklist reaches the client with the shape it
 * has always had rather than a narrowed copy of it.
 */
export function createIntegrationsChecksTrpcRouter<
  TContext extends IntegrationsChecksTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TCheckStatus,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    TrpcApiPorts<IntegrationsChecksTrpcPorts<TCheckStatus>>,
) {
  return IntegrationsChecksTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}
