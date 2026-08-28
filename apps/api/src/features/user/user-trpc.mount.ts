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
  IdentityTrpcApi,
  UserTrpcApi,
  type IdentityTrpcContext,
  type IdentityTrpcPorts,
  type UserTrpcContext,
  type UserTrpcPorts,
} from "@langwatch/user-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { declaredPolicy, type AppTrpcPolicyMiddlewares } from "../../app-trpc/app-trpc.policy";

type IdentityMount<
  TContext extends IdentityTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  ports: IdentityTrpcPorts;
}>;

/** Mounts `identity.*` on the app process's tRPC root. */
export function createIdentityTrpcRouter<
  TContext extends IdentityTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: IdentityMount<TContext, TOptions, TRoot>) {
  return IdentityTrpcApi.create(
    mount.root,
    {
      protected: mount.protectedProcedure,
      policy: declaredPolicy(mount.middlewares),
    },
    mount.ports,
  );
}

type UserMount<
  TContext extends UserTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /** `user.register` runs before an account exists, so it takes no session. */
  publicProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  ports: UserTrpcPorts;
}>;

/** Mounts `user.*` on the app process's tRPC root. */
export function createUserTrpcRouter<
  TContext extends UserTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: UserMount<TContext, TOptions, TRoot>) {
  return UserTrpcApi.create(
    mount.root,
    {
      protected: mount.protectedProcedure,
      public: mount.publicProcedure,
      policy: declaredPolicy(mount.middlewares),
    },
    mount.ports,
  );
}
