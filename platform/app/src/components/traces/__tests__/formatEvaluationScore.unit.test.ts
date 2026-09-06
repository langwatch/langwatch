import { describe, expect, it } from "vitest";

import { formatEvaluationScore } from "../EvaluationStatusItem";

/**
 * Characterization test for langwatch/langwatch#6397.
 *
 * `formatEvaluationScore` returns "N/A" before handing a value to `numeral`,
 * and it had no test file at all — so "existing suites pass" asserted nothing
 * about it. The zero case is the load-bearing one: `llm_boolean` returns
 * `score = 1 if passed else 0`, so a genuine 0.0 is real data, and any guard
 * rewritten as a falsy check (`score ? … : "N/A"`) would silently start
 * reporting real zeros as not-scored.
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
