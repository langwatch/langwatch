// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  createRecordingMeterProvider,
  type RecordingMeterProvider,
} from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTOMATION_MATCH_RECORDS_METRIC_DESCRIPTION,
  AUTOMATION_MATCH_RECORDS_METRIC_NAME,
  OtelTraceAlertMetricsAdapter,
} from "../otel.trace-alert-metrics.adapter";

describe("OtelTraceAlertMetricsAdapter", () => {
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
        const adapter = OtelTraceAlertMetricsAdapter.create();

        adapter.countRecorded(3);
        adapter.countRecorded(2);

        expect(metrics.valueOf("automation_match_records_total")).toBe(5);
      });

      /** @scenario "The trigger match series carries no per-project label" */
      it("writes no attributes at all", () => {
        OtelTraceAlertMetricsAdapter.create().countRecorded(1);

        expect(metrics.recorded).toEqual([
          {
            instrument: "automation_match_records_total",
            value: 1,
            attributes: {},
          },
        ]);
      });
    });
  });

  describe("given a trace that produced no trigger match records", () => {
    describe("when the count is recorded", () => {
      /** @scenario "A trace that matched nothing does not write a zero" */
      it("writes nothing", () => {
        OtelTraceAlertMetricsAdapter.create().countRecorded(0);

        expect(metrics.recorded).toEqual([]);
      });
    });
  });
});
