/**
 * App-process transport mount for the experiment vertical.
 *
 * Behaviour is package-owned (`@langwatch/experiment-server`); this supplies
 * the process's tRPC root, its authenticated procedure, its policy chain, and
 * the workflow, monitor and identity collaborators an experiment still reaches
 * through the application while those verticals are drained.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import {
  ExperimentTrpcApi,
  type ExperimentTrpcContext,
  type ExperimentTrpcPorts,
} from "@langwatch/experiment-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/**
 * Mounts `experiments.*` on the app process's tRPC root.
 *
 * The ports are forwarded untouched. `TWorkbenchState` is inferred from the
 * host's own schema, which is built out of its evaluation preconditions and
 * trace-mapping shapes rather than anything the experiment package owns.
 */
export function createExperimentTrpcRouter<
  TContext extends ExperimentTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TWorkbenchState,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    TrpcApiPorts<ExperimentTrpcPorts<TWorkbenchState>>,
) {
  return ExperimentTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}
