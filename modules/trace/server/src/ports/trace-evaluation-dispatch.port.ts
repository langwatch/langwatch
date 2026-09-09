import type { QueueSendOptions } from "@langwatch/eventing";
import type { ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";

/**
 * Sending one online-evaluator run for an ingested trace.
 *
 * Two methods, because the dispatch is two decisions that belong to different
 * features. The PAYLOAD is Trace's: the fold state, the monitor, the delay and
 * the TTL are all read off a trace. The DEDUPLICATION KEY is Evaluation's:
 * `ExecuteEvaluationCommand.makeJobId` is the identity of an evaluation run,
 * and the queue squashes against it. Trace asks for that key rather than
 * spelling it, because a second spelling would not collide with the first and
 * the same evaluation would run twice.
 *
 * This is a port and not an import for a reason the linter enforces: a feature
 * server cannot depend on another feature's server package (`cross-feature` in
 * `architecture-lint`), and `ExecuteEvaluationCommand` lives in
 * `@langwatch/evaluation-server`. The composition root holds both and wires
 * them together, which is also what lets a process dispatch evaluations
 * without building the evaluator engine behind them.
 */
export abstract class TraceEvaluationDispatchPort {
  /**
   * The queue deduplication id for this evaluation run. Called by the queue
   * for every send, so it must stay pure and cheap.
   */
  abstract makeDedupId(data: ExecuteEvaluationCommandData): string;

  abstract send(
    data: ExecuteEvaluationCommandData,
    options?: QueueSendOptions<ExecuteEvaluationCommandData>,
  ): Promise<void>;
}
