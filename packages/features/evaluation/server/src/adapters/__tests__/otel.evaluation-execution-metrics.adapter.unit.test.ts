import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  EVALUATION_DURATION_METRIC_NAME,
  EVALUATION_STATUS_METRIC_NAME,
  OtelEvaluationExecutionMetricsAdapter,
} from "../otel.evaluation-execution-metrics.adapter";

/**
 * Spec: packages/features/evaluation/specs/evaluation-service.feature
 *
 * The names and the label are pinned as literals because they are read by name
 * from outside this repository — `docs/langwatch-dashboard.json` charts both —
 * and because every way they can go wrong is silent: a panel naming a series
 * nobody writes renders empty, which reads as "no evaluations ran".
 */
describe("given the evaluator process series pushed over OTLP", () => {
  const metrics = createRecordingMeterProvider();

  beforeEach(() => metrics.install());
  afterEach(() => metrics.uninstall());

  /** @scenario "An evaluator run reports its duration and its outcome" */
  it("writes the two series under the names the dashboard reads", () => {
    expect(EVALUATION_DURATION_METRIC_NAME).toBe("evaluation_duration_milliseconds");
    expect(EVALUATION_STATUS_METRIC_NAME).toBe("evaluation_status_counter");
  });

  /** @scenario "An evaluator run reports its duration and its outcome" */
  it("observes the run's duration under the evaluator that produced it", () => {
    const adapter = OtelEvaluationExecutionMetricsAdapter.create();

    adapter.record({ evaluatorType: "ragas/bleu_score", status: "processed", durationMs: 42 });
    adapter.record({ evaluatorType: "ragas/bleu_score", status: "processed", durationMs: 7 });
    adapter.record({ evaluatorType: "azure/jailbreak", status: "processed", durationMs: 900 });

    expect(
      metrics.valuesOf("evaluation_duration_milliseconds", {
        evaluator_type: "ragas/bleu_score",
      }),
    ).toEqual([42, 7]);
    expect(
      metrics.valuesOf("evaluation_duration_milliseconds", {
        evaluator_type: "azure/jailbreak",
      }),
    ).toEqual([900]);
  });

  /** @scenario "An evaluator run reports its duration and its outcome" */
  it("counts each outcome separately, so an all-error hour cannot read as load", () => {
    const adapter = OtelEvaluationExecutionMetricsAdapter.create();

    adapter.record({ evaluatorType: "ragas/bleu_score", status: "error", durationMs: 1 });
    adapter.record({ evaluatorType: "ragas/bleu_score", status: "error", durationMs: 1 });
    adapter.record({ evaluatorType: "ragas/bleu_score", status: "skipped", durationMs: 1 });

    expect(
      metrics.valueOf("evaluation_status_counter", {
        evaluator_type: "ragas/bleu_score",
        status: "error",
      }),
    ).toBe(2);
    expect(
      metrics.valueOf("evaluation_status_counter", {
        evaluator_type: "ragas/bleu_score",
        status: "skipped",
      }),
    ).toBe(1);
  });
});
