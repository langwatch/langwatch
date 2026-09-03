import {
  counter,
  histogram,
  type CounterHandle,
  type HistogramHandle,
} from "@langwatch/observability/metrics";

import { EvaluationExecutionTelemetryPort } from "../ports/evaluation-execution.port";

/**
 * The two series an evaluation run reports, and the label that tells one
 * evaluator's runs from another's.
 *
 * Pinned as literals because they are read by name from outside this
 * repository — `docs/langwatch-dashboard.json` charts
 * `evaluation_duration_milliseconds_bucket` by `evaluator_type` and counts
 * `evaluation_status_counter` by `status` — and because every way they can go
 * wrong is silent: a panel naming a series nobody writes renders empty, which
 * reads as "no evaluations ran" rather than "the metric moved".
 *
 * They are the SAME two series `OtelPiiAnalysisMetricsAdapter` writes for the
 * PII analysis path, distinguished only by the `evaluator_type` label value.
 * That is deliberate and predates the split: one dashboard row covers every
 * evaluator, and PII detection is one of them.
 */
export const EVALUATION_DURATION_METRIC_NAME = "evaluation_duration_milliseconds";
export const EVALUATION_STATUS_METRIC_NAME = "evaluation_status_counter";

/**
 * An evaluation run's duration and outcome, pushed over OTLP.
 *
 * No registry is held or handed in: `histogram()` and `counter()` resolve the
 * process's own meter at declaration, the same way every other `otel.*-metrics`
 * adapter in the tree does, and the bucket boundaries come from
 * `HISTOGRAM_BOUNDARIES` rather than from this file. That is why the port takes
 * a `record(...)` and nothing else — a process composes this adapter or it
 * composes none, and the difference is a missing series rather than a wrong one.
 */
export class OtelEvaluationExecutionMetricsAdapter extends EvaluationExecutionTelemetryPort {
  static create(): OtelEvaluationExecutionMetricsAdapter {
    return new OtelEvaluationExecutionMetricsAdapter(
      histogram({
        name: EVALUATION_DURATION_METRIC_NAME,
        description: "Duration of evaluations in milliseconds",
      }),
      counter({
        name: EVALUATION_STATUS_METRIC_NAME,
        description: "Count of evaluations status results",
      }),
    );
  }

  private constructor(
    private readonly duration: HistogramHandle,
    private readonly status: CounterHandle,
  ) {
    super();
  }

  record(input: {
    evaluatorType: string;
    status: "processed" | "skipped" | "error";
    durationMs: number;
  }): void {
    this.duration.observe(input.durationMs, { evaluator_type: input.evaluatorType });
    this.status.inc({ evaluator_type: input.evaluatorType, status: input.status });
  }
}
