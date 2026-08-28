/**
 * App-process transport mount for the scenario vertical.
 *
 * Behaviour is package-owned (`@langwatch/scenario-server`); this supplies the
 * process's root, authenticated procedure, policy chain and the two
 * fire-and-forget process side effects a created scenario triggers.
 */
import {
  ScenarioTrpcApi,
  type ScenarioTrpcContext,
  type ScenarioTrpcPorts,
} from "@langwatch/scenario-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { appTrpcPolicy, type AppTrpcPolicyMiddlewares } from "../../app-trpc/app-trpc.policy";

type ScenarioMount<
  TContext extends ScenarioTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  ports: ScenarioTrpcPorts;
}>;

/** Mounts `scenarios.*` on the app process's tRPC root. */
export function createScenarioTrpcRouter<
  TContext extends ScenarioTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: ScenarioMount<TContext, TOptions, TRoot>) {
  return ScenarioTrpcApi.create(
    mount.root,
    {
      protected: mount.protectedProcedure,
      policy: appTrpcPolicy(mount.middlewares),
    },
    mount.ports,
  );
}
