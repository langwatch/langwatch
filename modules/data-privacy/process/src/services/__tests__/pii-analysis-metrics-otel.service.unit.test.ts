import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PiiAnalysisMetricsOtelService,
  PII_ANALYSIS_DURATION_METRIC_NAME,
  PII_ANALYSIS_EVALUATOR_TYPE,
  PII_ANALYSIS_STATUS_METRIC_NAME,
  PII_CHECKS_METRIC_NAME,
} from "../pii-analysis-metrics-otel.service.ts";

/**
 * Spec: modules/data-privacy/specs/span-pii-redaction.feature. Names and
 * labels are pinned as literals, read by name outside this repository —
 * an unwritten series renders empty, reading as "no PII checks" not "moved".
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
    const adapter = PiiAnalysisMetricsOtelService.create();

    adapter.analysisCalled("presidio");
    adapter.analysisCalled("presidio");
    adapter.analysisCalled("google_dlp");

    expect(metrics.valueOf("pii_checks", { method: "presidio" })).toBe(2);
    expect(metrics.valueOf("pii_checks", { method: "google_dlp" })).toBe(1);
  });

  /** @scenario "An operator can see the analysis calls from either process" */
  it("observes the batch duration under the evaluator label the App uses", () => {
    PiiAnalysisMetricsOtelService.create().analysisObserved(42);

    expect(
      metrics.valuesOf("evaluation_duration_milliseconds", {
        evaluator_type: "presidio/pii_detection",
      }),
    ).toEqual([42]);
  });

  /** @scenario "An operator can see the analysis calls from either process" */
  it("counts each outcome separately, so an all-error batch cannot read as load", () => {
    const adapter = PiiAnalysisMetricsOtelService.create();

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
