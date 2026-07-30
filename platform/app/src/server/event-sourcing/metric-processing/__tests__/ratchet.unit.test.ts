import { checkTypeStringRatchet } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
  checkMetricProcessingRatchet,
  currentMetricProcessingTypeStrings,
  METRIC_PROCESSING_TYPE_STRING_SNAPSHOT,
} from "../ratchet";

describe("the metric-processing type-string ratchet (ADR-105 decision 10)", () => {
  /** @scenario The aggregate's persisted event-type strings are ratcheted */
  it("passes against the committed snapshot right now", () => {
    expect(checkMetricProcessingRatchet()).toEqual([]);
  });

  it("commits every type string the pipeline currently declares", () => {
    expect(METRIC_PROCESSING_TYPE_STRING_SNAPSHOT.metric).toEqual(
      currentMetricProcessingTypeStrings().metric,
    );
  });

  it("would fail if a committed string went missing — proving the check actually checks something", () => {
    const violations = checkTypeStringRatchet({
      snapshot: {
        metric: [
          "lw.obs.metric.data_point_received",
          "lw.obs.metric.a_type_that_used_to_exist",
        ],
      },
      current: currentMetricProcessingTypeStrings(),
    });
    expect(violations).toEqual([
      {
        declaration: "metric",
        missing: ["lw.obs.metric.a_type_that_used_to_exist"],
      },
    ]);
  });
});
