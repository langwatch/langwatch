/** Binds the feature's declared procedures to this process's execution path. */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { evaluatorTrpcTransport } from "@langwatch/evaluator-server";

/** The one slice of the process context the `evaluators` namespace reads. */
export interface EvaluatorHostContext {
  app: Readonly<{ evaluatorApp: EvaluatorApi }>;
}

/** Mounts `evaluators.*`. */
export function createEvaluatorTrpcRouter<TContext extends EvaluatorHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(evaluatorTrpcTransport, (ctx) => ctx.app.evaluatorApp);
}
