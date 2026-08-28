/**
 * App-process transport mount for the "what may I do here" read.
 *
 * Behaviour is package-owned (`@langwatch/authz-server`); this supplies the
 * process's root, authenticated procedure and policy chain. There are no
 * ports: the answer comes from the authz service the request context already
 * carries.
 */
import { AuthzTrpcApi, type AuthzTrpcContext } from "@langwatch/authz-server";
import { createTrpcApiService, type TrpcApiMount } from "@langwatch/api/trpc";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `authz.*` on the app process's tRPC root. */
export function createAuthzTrpcRouter<
  TContext extends AuthzTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot>) {
  return AuthzTrpcApi.create(mount.root, createTrpcApiService(mount));
}
