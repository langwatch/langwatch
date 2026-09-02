/**
 * App-process transport mount for the evaluator vertical.
 *
 * Behaviour is package-owned (`@langwatch/evaluator-server`); this supplies the
 * process's root, authenticated procedure, policy chain and the six things an
 * evaluator reaches that the evaluator package does not own — all of them about
 * the WORKFLOW behind a workflow evaluator, or about the monitors that run it.
 *
 * Neither the Evaluator nor the Monitor package reaches into a studio graph:
 * its DSL, its dataset references and its version history belong to Workflow.
 * So replicating one is the host's, and it is the host's in the same way for
 * `evaluators.copy` and `monitors.copy` — one implementation, so a replica made
 * from either surface is the same self-contained evaluator in the target
 * project rather than a dangling cross-project reference.
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
    { protected: service.protected, policy: (permission) => service.policy(permission) },
    mount.ports,
  );
}
