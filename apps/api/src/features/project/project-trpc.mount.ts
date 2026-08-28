/**
 * App-process transport mount for the project vertical's home surface.
 *
 * Behaviour is package-owned (`@langwatch/project-server`); this supplies the
 * process's root, authenticated procedure, policy chain, and the recent-items
 * reader, which walks the process's audit trail and hydrates each entity it
 * finds there.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import { HomeTrpcApi, type HomeTrpcContext, type HomeTrpcPorts } from "@langwatch/project-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `home.*` on the app process's tRPC root. */
export function createHomeTrpcRouter<
  TContext extends HomeTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<HomeTrpcPorts>) {
  return HomeTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}
