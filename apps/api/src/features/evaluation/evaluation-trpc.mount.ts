/** Binds the feature's declared procedures to this process's execution path. */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import { evaluationTrpcTransport } from "@langwatch/evaluation-server";

/**
 * The one slice of the process context the `evaluations` namespace reads. It is
 * also the wire namespace the browser calls and the key tRPC hashes into its
 * query cache, so the two spellings are the same on purpose.
 */
export interface EvaluationHostContext {
  app: Readonly<{ evaluations: EvaluationApi }>;
}

/** Mounts `evaluations.*`. */
export function createEvaluationTrpcRouter<TContext extends EvaluationHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(evaluationTrpcTransport, (ctx) => ctx.app.evaluations);
}
