/**
 * `evaluators.copy`/`monitors.copy` share one replication implementation so
 * a copy is self-contained, not a dangling cross-project reference.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import {
  EvaluatorTrpcApi,
  type EvaluatorTrpcContext,
  type EvaluatorTrpcPorts,
} from "@langwatch/evaluator-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `evaluators.*` on the app process's tRPC root. */
export function createEvaluatorTrpcRouter<
  TContext extends EvaluatorTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<EvaluatorTrpcPorts>) {
  const service = createTrpcApiService(mount);
  return EvaluatorTrpcApi.create(
    mount.root,
    {
      protected: service.protected,
      policy: (permission) => service.policy(permission),
      validateOutput: service.validateOutput,
    },
    mount.ports,
  );
}
