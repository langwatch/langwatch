import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  OtelPiiAnalysisMetricsAdapter,
  PII_ANALYSIS_DURATION_METRIC_NAME,
  PII_ANALYSIS_EVALUATOR_TYPE,
  PII_ANALYSIS_STATUS_METRIC_NAME,
  PII_CHECKS_METRIC_NAME,
} from "../otel.pii-analysis-metrics.adapter";

/**
 * Spec: packages/features/data-privacy/specs/span-pii-redaction.feature
 *
 * The names and labels are pinned as literals because they are read by name
 * outside this repository, and every way they can go wrong is silent: a panel
 * that names a series nobody writes renders empty, which reads as "no PII
 * checks are happening" rather than "the metric moved".
 */
describe("given the PII analysis metrics pushed over OTLP", () => {
  const metrics = createRecordingMeterProvider();

  beforeEach(() => metrics.install());
  afterEach(() => metrics.uninstall());

  /** @scenario "An operator can see the analysis calls from either process" */
  it("writes the application's three series under the application's names", () => {
    expect(PII_CHECKS_METRIC_NAME).toBe("pii_checks");
    expect(PII_ANALYSIS_DURATION_METRIC_NAME).toBe("evaluation_duration_milliseconds");
    expect(PII_ANALYSIS_STATUS_METRIC_NAME).toBe("evaluation_status_counter");
    expect(PII_ANALYSIS_EVALUATOR_TYPE).toBe("presidio/pii_detection");
  });

  /** @scenario "An operator can see the analysis calls from either process" */
  it("counts one analysis call per method, under the method label", () => {
    const adapter = OtelPiiAnalysisMetricsAdapter.create();

    adapter.analysisCalled("presidio");
    adapter.analysisCalled("presidio");
    adapter.analysisCalled("google_dlp");

    expect(metrics.valueOf("pii_checks", { method: "presidio" })).toBe(2);
    expect(metrics.valueOf("pii_checks", { method: "google_dlp" })).toBe(1);
  });

  /** @scenario "An operator can see the analysis calls from either process" */
  it("observes the batch duration under the evaluator label the App uses", () => {
    OtelPiiAnalysisMetricsAdapter.create().analysisObserved(42);

    expect(
      metrics.valuesOf("evaluation_duration_milliseconds", {
        evaluator_type: "presidio/pii_detection",
      }),
    ).toEqual([42]);
  });

  /** @scenario "An operator can see the analysis calls from either process" */
  it("counts each outcome separately, so an all-error batch cannot read as load", () => {
    const adapter = OtelPiiAnalysisMetricsAdapter.create();

    adapter.analysisFinished("processed");
    adapter.analysisFinished("error");
    adapter.analysisFinished("error");

    expect(
      metrics.valueOf("evaluation_status_counter", {
        evaluator_type: "presidio/pii_detection",
        status: "error",
      }),
    ).toBe(2);
    expect(
      metrics.valueOf("evaluation_status_counter", {
        evaluator_type: "presidio/pii_detection",
        status: "processed",
      }),
    ).toBe(1);
  });
});
