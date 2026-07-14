import { describe, it, expect } from "vitest";
import { analyticsMetrics } from "../registry";

describe("analyticsMetrics", () => {
  describe("evaluation_pass_rate", () => {
    /** @scenario "Evaluation pass rate displays as percentage" */
    it("uses percentage format", () => {
      expect(analyticsMetrics.evaluations.evaluation_pass_rate.format).toBe(
        "0%",
      );
    });
  });
});
