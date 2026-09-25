import {
  counter,
  histogram,
  type CounterHandle,
  type HistogramHandle,
} from "@langwatch/observability/metrics";

import type { EvaluationExecutionTelemetry } from "../app/evaluation.members.ts";

/**
 * Two metric series pinned as literals (read by dashboards) with
 * evaluator_type label.
 */
export const EVALUATION_DURATION_METRIC_NAME = "evaluation_duration_milliseconds";
export const EVALUATION_STATUS_METRIC_NAME = "evaluation_status_counter";

/** Evaluation run duration and outcome over OTLP; meter resolved at declaration. */
export class OtelEvaluationExecutionMetricsService implements EvaluationExecutionTelemetry {
  static create(): OtelEvaluationExecutionMetricsService {
    return new OtelEvaluationExecutionMetricsService(
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
  ) {}

  record(input: {
    evaluatorType: string;
    status: "processed" | "skipped" | "error";
    durationMs: number;
  }): void {
    this.duration.observe(input.durationMs, { evaluator_type: input.evaluatorType });
    this.status.inc({ evaluator_type: input.evaluatorType, status: input.status });
  }
}
