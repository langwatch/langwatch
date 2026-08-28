/**
 * App-process transport mount for the experiment vertical.
 *
 * Behaviour is package-owned (`@langwatch/experiment-server`); this supplies
 * the process's tRPC root, its authenticated procedure, its policy chain, and
 * the workflow, monitor and identity collaborators an experiment still reaches
 * through the application while those verticals are drained.
 */
import {
  ExperimentTrpcApi,
  type ExperimentTrpcContext,
  type ExperimentTrpcPorts,
} from "@langwatch/experiment-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { appTrpcPolicy, type AppTrpcPolicyMiddlewares } from "../../app-trpc/app-trpc.policy";

type ExperimentMount<
  TContext extends ExperimentTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TWorkbenchState,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  /**
   * Forwarded untouched. `TWorkbenchState` is inferred from the host's own
   * schema, which is built out of its evaluation preconditions and
   * trace-mapping shapes rather than anything the experiment package owns.
   */
  ports: ExperimentTrpcPorts<TWorkbenchState>;
}>;

/** Mounts `experiments.*` on the app process's tRPC root. */
export function createExperimentTrpcRouter<
  TContext extends ExperimentTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TWorkbenchState,
>(mount: ExperimentMount<TContext, TOptions, TRoot, TWorkbenchState>) {
  return ExperimentTrpcApi.create(
    mount.root,
    { protected: mount.protectedProcedure, policy: appTrpcPolicy(mount.middlewares) },
    mount.ports,
  );
}
