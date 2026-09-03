/**
 * App-process transport mounts for the user vertical.
 *
 * Behaviour is package-owned (`@langwatch/user-server`); this supplies the
 * process's root, its authenticated and public procedures, the policy chain,
 * and the application ports the user package does not own.
 *
 * Both surfaces act on the SESSION's own account, which is why neither takes a
 * permission for most of its procedures: `identity.completeVerification`
 * spends the caller's own verification record, and `user.*` reads and writes
 * the caller's own profile, credentials and avatar. The four organization
 * scoped procedures — the avatar upload and the /me dashboard reads — take
 * `organization:view` through the same policy chain as every other feature.
 */
import {
  createTrpcApiService,
  type TrpcApiMount,
  type TrpcApiPorts,
  type TrpcApiPublicMount,
} from "@langwatch/api/trpc";
import {
  IdentityTrpcApi,
  UserTrpcApi,
  type IdentityTrpcContext,
  type IdentityTrpcPorts,
  type UserTrpcContext,
  type UserTrpcPorts,
} from "@langwatch/user-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `identity.*` on the app process's tRPC root. */
export function createIdentityTrpcRouter<
  TContext extends IdentityTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<IdentityTrpcPorts>) {
  return IdentityTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}

/**
 * Mounts `user.*` on the app process's tRPC root.
 *
 * `user.register` runs before an account exists, so this mount takes the
 * process's public procedure as well as its authenticated one.
 */
export function createUserTrpcRouter<
  TContext extends UserTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    TrpcApiPublicMount<TContext, TOptions, TRoot> &
    TrpcApiPorts<UserTrpcPorts>,
) {
  return UserTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}
