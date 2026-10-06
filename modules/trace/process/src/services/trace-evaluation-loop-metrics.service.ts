import { counter, type CounterHandle } from "@langwatch/observability/metrics";

/**
 * Why an online-evaluator dispatch was refused: `depth_direct` reads the
 * incoming span, `depth_fold` reads the same check off the folded trace state
 * on the deferred-origin path, `parent_in_subtree` is an already-covered parent.
 */
export type TraceEvaluationLoopBlockReason = "depth_direct" | "depth_fold" | "parent_in_subtree";

/** What an operator can see about evaluations the loop guards refused. A port
 * because different processes export differently: app uses prom-client, packages
 * push over OTLP. Both write the same series to keep the dashboard consistent. */
export interface TraceEvaluationLoopMetrics {
  loopBlocked(reason: TraceEvaluationLoopBlockReason): void;
}

/**
 * The series name, help text and one label, pinned because two processes
 * write them: a rename silently empties the panel (reads as "guards never
 * fire"), and a dropped label collapses both block reasons into one number.
 */
export const EVALUATOR_LOOP_BLOCKED_METRIC_NAME = "langwatch_evaluator_loop_blocked_total";
export const EVALUATOR_LOOP_BLOCKED_METRIC_DESCRIPTION =
  "Number of online-evaluator dispatches blocked by the loop guards";
export const EVALUATOR_LOOP_BLOCKED_REASON_LABEL = "reason";

/** Loop-guard refusals, pushed over OTLP. */
export class TraceEvaluationLoopMetricsService implements TraceEvaluationLoopMetrics {
  static create(): TraceEvaluationLoopMetricsService {
    return new TraceEvaluationLoopMetricsService(
      counter({
        name: EVALUATOR_LOOP_BLOCKED_METRIC_NAME,
        description: EVALUATOR_LOOP_BLOCKED_METRIC_DESCRIPTION,
      }),
    );
  }

  private constructor(private readonly blocked: CounterHandle) {}

  loopBlocked(reason: TraceEvaluationLoopBlockReason): void {
    this.blocked.inc({ [EVALUATOR_LOOP_BLOCKED_REASON_LABEL]: reason });
  }
}
