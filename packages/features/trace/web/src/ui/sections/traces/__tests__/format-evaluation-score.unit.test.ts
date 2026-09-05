import { describe, expect, it } from "vitest";

import { formatEvaluationScore } from "../evaluation-status-item";

/**
 * Characterization test for langwatch/langwatch#6397.
 */
describe("formatEvaluationScore", () => {
  describe("given a score that is absent", () => {
    describe("when it is formatted", () => {
      /** @scenario The shared score formatter distinguishes absent from zero */
      it("renders undefined as N/A", () => {
        expect(formatEvaluationScore(undefined)).toBe("N/A");
      });

      it("renders null as N/A", () => {
        expect(formatEvaluationScore(null)).toBe("N/A");
      });
    });
  });

  describe("given a score that is a real number", () => {
    describe("when it is formatted", () => {
      it("renders a genuine zero as 0, not N/A", () => {
        expect(formatEvaluationScore(0)).toBe("0");
      });

      it("renders a fractional score without trailing zeros", () => {
        expect(formatEvaluationScore(0.5)).toBe("0.5");
      });

      it("renders a whole score without a decimal part", () => {
        expect(formatEvaluationScore(1)).toBe("1");
      });
    });
  });
});
