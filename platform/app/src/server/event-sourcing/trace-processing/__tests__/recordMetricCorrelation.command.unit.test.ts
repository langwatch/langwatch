import { describe, expect, it } from "vitest";
import { recordMetricCorrelation } from "../recordMetricCorrelation.command";
import { TRACE_ID } from "./fixtures";

function correlation(overrides: { spanId?: string } = {}) {
  return {
    traceId: TRACE_ID,
    spanId: overrides.spanId ?? "e".repeat(16),
    pointId: "c".repeat(64),
    seriesId: "d".repeat(64),
    metricName: "gen_ai.server.time_to_first_token",
    metricUnit: "ms",
    metricKind: "histogram" as const,
    exemplarValue: 12,
    exemplarTimeUnixMs: 5,
  };
}

describe("the recordMetricCorrelation command", () => {
  describe("when the span id is an all-zero sentinel", () => {
    it("emits nothing", async () => {
      const input = correlation({ spanId: "0".repeat(16) });
      expect(await recordMetricCorrelation(input)).toEqual([]);
    });
  });

  describe("when the span id is real", () => {
    it("emits exactly the metricDataPointCorrelated event", async () => {
      const input = correlation();
      expect(await recordMetricCorrelation(input)).toEqual([
        { type: "metricDataPointCorrelated", data: input },
      ]);
    });
  });
});
