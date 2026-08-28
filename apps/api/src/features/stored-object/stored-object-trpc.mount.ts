/**
 * App-process transport mount for the stored-object probe surface.
 *
 * Behaviour is package-owned (`@langwatch/stored-object-server`); this supplies
 * the process's root, authenticated procedure and policy chain.
 */
import { StoredObjectTrpcApi, type StoredObjectTrpcContext } from "@langwatch/stored-object-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { appTrpcPolicyAny, type AppTrpcPolicyMiddlewares } from "../../app-trpc/app-trpc.policy";

type StoredObjectMount<
  TContext extends StoredObjectTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
}>;

/** Mounts `storedObjects.*` on the app process's tRPC root. */
export function createStoredObjectTrpcRouter<
  TContext extends StoredObjectTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: StoredObjectMount<TContext, TOptions, TRoot>) {
  return StoredObjectTrpcApi.create(mount.root, {
    protected: mount.protectedProcedure,
    policyAny: appTrpcPolicyAny(mount.middlewares),
  });
}
