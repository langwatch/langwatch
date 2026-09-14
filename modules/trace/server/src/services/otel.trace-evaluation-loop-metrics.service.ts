import { counter, type CounterHandle } from "@langwatch/observability/metrics";
import {
  type TraceEvaluationLoopMetrics,
  type TraceEvaluationLoopBlockReason,
} from "../app/trace.members.ts";

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
export class OtelTraceEvaluationLoopMetricsAdapter implements TraceEvaluationLoopMetrics {
  static create(): OtelTraceEvaluationLoopMetricsAdapter {
    return new OtelTraceEvaluationLoopMetricsAdapter(
      counter({
        name: EVALUATOR_LOOP_BLOCKED_METRIC_NAME,
        description: EVALUATOR_LOOP_BLOCKED_METRIC_DESCRIPTION,
      }),
    );
  }

  private constructor(private readonly blocked: CounterHandle) {
  }

  loopBlocked(reason: TraceEvaluationLoopBlockReason): void {
    this.blocked.inc({ [EVALUATOR_LOOP_BLOCKED_REASON_LABEL]: reason });
  }
}
