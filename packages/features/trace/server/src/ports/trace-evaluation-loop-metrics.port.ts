/**
 * Why an online-evaluator dispatch was refused by the loop guards.
 *
 * The two values are the guard's own vocabulary: `depth_direct` is a trace whose
 * evaluation would evaluate an evaluation, and `parent_in_subtree` is a trace
 * whose parent is already inside the subtree being evaluated. An operator reads
 * the two apart to tell a customer's recursive pipeline from our own fan-out.
 */
export type TraceEvaluationLoopBlockReason = "depth_direct" | "parent_in_subtree";

/**
 * What an operator can see about evaluations the loop guards refused.
 *
 * It is a port because the two processes that dispatch evaluations export
 * differently: the application increments its own `prom-client` registry
 * (`platform/app/src/server/metrics.ts`), and a process composed from packages
 * pushes over OTLP. Both must write the same series under the same name with
 * the same label, because the dashboard that answers "is the loop guard firing"
 * cannot be asked which process made the dispatch.
 *
 * Tenant attribution deliberately stays out of the labels and lives in the
 * structured log line instead — one label per project is unbounded cardinality
 * on a metric that fires per dispatch.
 */
export abstract class TraceEvaluationLoopMetricsPort {
  abstract loopBlocked(reason: TraceEvaluationLoopBlockReason): void;
}
