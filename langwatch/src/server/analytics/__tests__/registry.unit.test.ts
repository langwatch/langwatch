import { describe, it, expect } from "vitest";
import { analyticsMetrics } from "../registry";

describe("analyticsMetrics", () => {
  describe("event_details", () => {
    describe("when calling aggregation()", () => {
      it("produces a key containing 'event_details', not 'event_score'", () => {
        const result = analyticsMetrics.events.event_details.aggregation(
          0,
          "avg",
          "key1",
          "subkey1",
        );

        const keys = Object.keys(result);
        expect(keys[0]).toContain("event_details");
        expect(keys[0]).not.toContain("event_score");
      });
    });

    describe("when calling extractionPath()", () => {
      it("produces a path containing 'event_details', not 'event_score'", () => {
        const path = analyticsMetrics.events.event_details.extractionPath(
          0,
          "avg",
          "key1",
          "subkey1",
        );

        expect(path).toContain("event_details");
        expect(path).not.toContain("event_score");
      });
    });
  });

  describe("evaluation_pass_rate", () => {
    it("uses percentage format", () => {
      expect(analyticsMetrics.evaluations.evaluation_pass_rate.format).toBe(
        "0%",
      );
    });
  });
});
