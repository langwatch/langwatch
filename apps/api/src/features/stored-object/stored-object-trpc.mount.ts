/**
 * App-process transport mount for the stored-object probe surface.
 *
 * Behaviour is package-owned (`@langwatch/stored-object-server`); this supplies
 * the process's root, authenticated procedure and policy chain.
 */
import { createTrpcApiService, type TrpcApiMount } from "@langwatch/api/trpc";
import { StoredObjectTrpcApi, type StoredObjectTrpcContext } from "@langwatch/stored-object-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `storedObjects.*` on the app process's tRPC root. */
export function createStoredObjectTrpcRouter<
  TContext extends StoredObjectTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot>) {
  return StoredObjectTrpcApi.create(mount.root, createTrpcApiService(mount));
}
