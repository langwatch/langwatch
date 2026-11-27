/** @see modules/trace/specs/trace-ingestion-metrics.feature */
import {
  createRecordingMeterProvider,
  type RecordingMeterProvider,
} from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AUTOMATION_MATCH_RECORDS_METRIC_DESCRIPTION,
  AUTOMATION_MATCH_RECORDS_METRIC_NAME,
  AutomationMatchRecordMetricsService,
} from "../../features/runaway/services/automation-match-record-metrics.service.ts";

describe("AutomationMatchRecordMetricsService", () => {
  let metrics: RecordingMeterProvider;

  beforeEach(() => {
    metrics = createRecordingMeterProvider();
    metrics.install();
  });

  afterEach(() => {
    metrics.uninstall();
  });

  describe("given the series two processes write", () => {
    it("keeps the application's series name and help text", () => {
      expect(AUTOMATION_MATCH_RECORDS_METRIC_NAME).toBe("automation_match_records_total");
      expect(AUTOMATION_MATCH_RECORDS_METRIC_DESCRIPTION).toBe(
        "Trigger match records written before any filter is evaluated",
      );
    });
  });

  describe("given a trace that produced trigger match records", () => {
    describe("when the count is recorded", () => {
      /** @scenario "Trigger match records are counted before any filter runs" */
      it("advances by the number of records written", () => {
        const metricsSink = AutomationMatchRecordMetricsService.create();

        metricsSink.countRecorded({ path: "trace", count: 3 });
        metricsSink.countRecorded({ path: "trace", count: 2 });

        expect(metrics.valueOf("automation_match_records_total")).toBe(5);
      });

      /** @scenario "The trigger match series carries only its path label" */
      it("writes the path and nothing else", () => {
        AutomationMatchRecordMetricsService.create().countRecorded({ path: "trace", count: 1 });

        expect(metrics.recorded).toEqual([
          {
            instrument: "automation_match_records_total",
            value: 1,
            attributes: { path: "trace" },
          },
        ]);
      });
    });
  });

  describe("given a settled evaluation that produced trigger match records", () => {
    describe("when the count is recorded", () => {
      /** @scenario "Evaluation trigger match records are counted under their own path" */
      it("advances under the evaluation path", () => {
        AutomationMatchRecordMetricsService.create().countRecorded({
          path: "evaluation",
          count: 2,
        });

        expect(metrics.recorded).toEqual([
          {
            instrument: "automation_match_records_total",
            value: 2,
            attributes: { path: "evaluation" },
          },
        ]);
      });
    });
  });

  describe("given a trace that produced no trigger match records", () => {
    describe("when the count is recorded", () => {
      /** @scenario "A trace that matched nothing does not write a zero" */
      it("writes nothing", () => {
        AutomationMatchRecordMetricsService.create().countRecorded({ path: "trace", count: 0 });

        expect(metrics.recorded).toEqual([]);
      });
    });
  });
});
