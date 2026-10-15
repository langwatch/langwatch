/**
 * @vitest-environment node
 * @see modules/insight/specs/insight-daily-run-hardening.feature
 */

import {
  createRecordingMeterProvider,
  type RecordingMeterProvider,
} from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  INSIGHT_DAILY_RUN_DURATION_METRIC_NAME as DURATION,
  INSIGHT_DAILY_RUN_TOTAL_METRIC_NAME as RUNS,
  InsightDailyRunMetricsService,
} from "../insight-daily-run-metrics.service.ts";

let metrics: RecordingMeterProvider;

beforeEach(() => {
  metrics = createRecordingMeterProvider();
  metrics.install();
});

afterEach(() => {
  metrics.uninstall();
});

describe("given the series a worker writes for daily runs", () => {
  it("keeps their names, with the unit as the last word of the duration", () => {
    expect(RUNS).toBe("insight_daily_run_total");
    expect(DURATION).toBe("insight_daily_run_duration_milliseconds");
  });
});

describe("given runs that end filed, skipped for no_access and failed for timeout", () => {
  describe("when each is recorded", () => {
    /** @scenario "Each recorded outcome is counted by outcome and reason" */
    it("advances the count once for each pair, and under none for a run with no reason", () => {
      const sink = InsightDailyRunMetricsService.create();

      sink.settled({ outcome: "filed", reason: null, durationMs: 4_000 });
      sink.settled({ outcome: "skipped", reason: "no_access", durationMs: 12 });
      sink.settled({ outcome: "skipped", reason: "no_access", durationMs: 9 });
      sink.settled({ outcome: "failed", reason: "timeout" });

      expect(metrics.valueOf(RUNS, { outcome: "filed", reason: "none" })).toBe(1);
      expect(metrics.valueOf(RUNS, { outcome: "skipped", reason: "no_access" })).toBe(2);
      expect(metrics.valueOf(RUNS, { outcome: "failed", reason: "timeout" })).toBe(1);
      expect(metrics.valueOf(RUNS)).toBe(4);
    });
  });
});

describe("given a run that took 4 seconds", () => {
  describe("when its outcome is recorded", () => {
    /** @scenario "A run's duration is recorded with its outcome" */
    it("holds 4,000 for that outcome, and no duration for a lost run", () => {
      const sink = InsightDailyRunMetricsService.create();

      sink.settled({ outcome: "filed", reason: null, durationMs: 4_000 });
      sink.settled({ outcome: "failed", reason: "timeout" });

      expect(metrics.valuesOf(DURATION, { outcome: "filed" })).toEqual([4_000]);
      expect(metrics.valuesOf(DURATION)).toEqual([4_000]);
    });
  });
});

describe("given a recorded run", () => {
  describe("when its metrics are written", () => {
    /** @scenario "The run metrics carry no project, person or board" */
    it("labels the count with outcome and reason, and the duration with outcome", () => {
      InsightDailyRunMetricsService.create().settled({
        outcome: "nothing",
        reason: "no_new_traces",
        durationMs: 30,
      });

      const labels = metrics.recorded.map(({ instrument, attributes }) => [
        instrument,
        Object.keys(attributes).toSorted(),
      ]);

      expect(labels).toEqual([
        [RUNS, ["outcome", "reason"]],
        [DURATION, ["outcome"]],
      ]);
    });
  });
});
