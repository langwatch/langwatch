/**
 * App-process transport mounts for the signed-out surfaces: the unauthenticated
 * front door, and the one deployment fact the sign-in page reads.
 *
 * Behaviour is package-owned (`@langwatch/auth-server`); this supplies the
 * process's root, its public and authenticated procedures, the policy chain,
 * and the application ports the auth package does not own — the throttle, the
 * sign-in router, the sign-up ceremony, the invitation reads, and the
 * deployment's resolved sign-in mode.
 */
import {
  FrontDoorTrpcApi,
  PublicEnvTrpcApi,
  type FrontDoorTrpcContext,
  type FrontDoorTrpcPorts,
  type PublicEnvTrpcContext,
  type PublicEnvTrpcPorts,
} from "@langwatch/auth-server";
import {
  createTrpcApiService,
  declaredPolicy,
  type AppTrpcPolicyMiddlewares,
  type TrpcApiMount,
  type TrpcApiPorts,
  type TrpcApiPublicMount,
} from "@langwatch/api/trpc";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";

/**
 * Mounts `frontDoor.*` on the app process's tRPC root.
 *
 * `sendMyAddressConfirmation` is the one procedure that needs a session; every
 * other one runs before the caller has an account.
 */
export function createFrontDoorTrpcRouter<
  TContext extends FrontDoorTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    TrpcApiPublicMount<TContext, TOptions, TRoot> &
    TrpcApiPorts<FrontDoorTrpcPorts>,
) {
  return FrontDoorTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}

type PublicEnvMount<
  TContext extends PublicEnvTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** No session: the sign-in page asks this before anyone has one. */
  publicProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  ports: PublicEnvTrpcPorts;
}>;

/**
 * Mounts `publicEnv` on the app process's tRPC root.
 *
 * A procedure rather than a router, because that is what the surface is: the
 * client calls `publicEnv({})` at the root, and giving it a namespace would
 * rename it. That is also why this one keeps its own mount type — there is no
 * root and no authenticated procedure for `createTrpcApiService` to compose.
 */
export function createPublicEnvTrpcProcedure<
  TContext extends PublicEnvTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: PublicEnvMount<TContext, TOptions, TRoot>) {
  return PublicEnvTrpcApi.create(
    {
      public: mount.publicProcedure,
      policy: declaredPolicy(mount.middlewares),
    },
    mount.ports,
  );
}
