import { counter, type CounterHandle } from "@langwatch/observability/metrics";
import {
  TraceEvaluationLoopMetricsPort,
  type TraceEvaluationLoopBlockReason,
} from "../ports/trace-evaluation-loop-metrics.port";

/**
 * The series name, its help text and its one label, pinned because two
 * processes write them.
 *
 * A renamed series produces an empty panel rather than an error, and an empty
 * loop-guard panel reads exactly like "the guards never fire" — which is the
 * answer an operator most wants to be able to trust, because the alternative is
 * an evaluation loop billing a customer for its own recursion. A dropped label
 * is just as silent: the two reasons collapse into one number and the guard
 * that fired becomes unknowable.
 */
export const EVALUATOR_LOOP_BLOCKED_METRIC_NAME = "langwatch_evaluator_loop_blocked_total";
export const EVALUATOR_LOOP_BLOCKED_METRIC_DESCRIPTION =
  "Number of online-evaluator dispatches blocked by the loop guards";
export const EVALUATOR_LOOP_BLOCKED_REASON_LABEL = "reason";

/** Loop-guard refusals, pushed over OTLP. */
export class OtelTraceEvaluationLoopMetricsAdapter extends TraceEvaluationLoopMetricsPort {
  static create(): OtelTraceEvaluationLoopMetricsAdapter {
    return new OtelTraceEvaluationLoopMetricsAdapter(
      counter({
        name: EVALUATOR_LOOP_BLOCKED_METRIC_NAME,
        description: EVALUATOR_LOOP_BLOCKED_METRIC_DESCRIPTION,
      }),
    );
  }

  private constructor(private readonly blocked: CounterHandle) {
    super();
  }

  loopBlocked(reason: TraceEvaluationLoopBlockReason): void {
    this.blocked.inc({ [EVALUATOR_LOOP_BLOCKED_REASON_LABEL]: reason });
  }
}
