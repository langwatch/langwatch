/**
 * App-process transport mount for the unauthenticated front door.
 *
 * Behaviour is package-owned (`@langwatch/auth-server`); this supplies the
 * process's root, its public and authenticated procedures, the policy chain,
 * and the application ports the auth package does not own — the throttle, the
 * sign-in router, the sign-up ceremony and the invitation reads.
 */
import {
  FrontDoorTrpcApi,
  type FrontDoorTrpcContext,
  type FrontDoorTrpcPorts,
} from "@langwatch/auth-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { declaredPolicy, type AppTrpcPolicyMiddlewares } from "../../app-trpc/app-trpc.policy";

type FrontDoorMount<
  TContext extends FrontDoorTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  /** `sendMyAddressConfirmation` is the one procedure that needs a session. */
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  publicProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  ports: FrontDoorTrpcPorts;
}>;

/** Mounts `frontDoor.*` on the app process's tRPC root. */
export function createFrontDoorTrpcRouter<
  TContext extends FrontDoorTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: FrontDoorMount<TContext, TOptions, TRoot>) {
  return FrontDoorTrpcApi.create(
    mount.root,
    {
      protected: mount.protectedProcedure,
      public: mount.publicProcedure,
      policy: declaredPolicy(mount.middlewares),
    },
    mount.ports,
  );
}
