import { analyticsMetrics } from "@langwatch/analytics-browser-kit";
import { describe, expect, it } from "vitest";

describe("analyticsMetrics", () => {
  describe("when reading evaluation_pass_rate", () => {
    /** @scenario "Evaluation pass rate displays as percentage" */
    it("uses percentage format", () => {
      expect(analyticsMetrics.evaluations.evaluation_pass_rate.format).toBe("0%");
    });
  });
});
