/**
 * App-process transport mount for the suite vertical.
 *
 * Behaviour is package-owned (`@langwatch/suite-server`); this supplies the
 * process's root, authenticated procedure and policy chain.
 */
import { SuiteTrpcApi, type SuiteTrpcContext } from "@langwatch/suite-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { appTrpcPolicy, type AppTrpcPolicyMiddlewares } from "../../app-trpc/app-trpc.policy";

type SuiteMount<
  TContext extends SuiteTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
}>;

/** Mounts `suites.*` (including `suites.folders.*`) on the app's tRPC root. */
export function createSuiteTrpcRouter<
  TContext extends SuiteTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: SuiteMount<TContext, TOptions, TRoot>) {
  return SuiteTrpcApi.create(mount.root, {
    protected: mount.protectedProcedure,
    policy: appTrpcPolicy(mount.middlewares),
  });
}
