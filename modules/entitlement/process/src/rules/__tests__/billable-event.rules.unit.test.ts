import { describe, expect, it } from "vitest";

import {
  BILLABLE_EVENT_TYPES,
  categoryOfBillableEventType,
  metricSeriesHourKey,
  NOT_BILLED,
} from "../billable-event.rules.ts";

describe("categoryOfBillableEventType", () => {
  describe("given the event types the meter bills", () => {
    /** @scenario "Every billable event type maps to one kind" */
    it("maps every one to the kind the usage page shows", () => {
      expect(
        Object.fromEntries(
          BILLABLE_EVENT_TYPES.map((type) => [type, categoryOfBillableEventType(type)]),
        ),
      ).toEqual({
        "lw.obs.trace.span_received": "spans",
        "lw.obs.log.record_received": "logs",
        "lw.obs.metric.data_point_received": "metrics",
        "lw.evaluation.reported": "evaluations",
        "lw.experiment_run.started": "experiments",
        "lw.experiment_run.evaluator_result": "experiments",
        "lw.experiment_run.target_result": "experiments",
        "lw.simulation_run.started": "scenarios",
        "lw.simulation_run.message_snapshot": "scenarios",
      });
    });

    /** @scenario "Every billable event type maps to one kind" */
    it("has no kind for a type the meter does not bill", () => {
      expect(categoryOfBillableEventType("lw.obs.trace.log_contributed")).toBe(NOT_BILLED);
    });
  });
});

describe("metricSeriesHourKey", () => {
  /** @scenario "A metric event without a series id falls back to the event's own key" */
  it("answers no_series_id for data without a valid series id", () => {
    expect(
      metricSeriesHourKey({ tenantId: "p", data: { seriesId: "x" }, receivedAtMs: 0 }),
    ).toEqual({ outcome: "no_series_id" });
  });
});
