/** @see modules/experiment/specs/experiment-run-results-completeness.feature */
import { describe, expect, it } from "vitest";

import { deriveRunCompleteness } from "../experiment-run-completeness.rules.ts";

describe("deriveRunCompleteness", () => {
  describe("given a run with stored rows and no finish marker", () => {
    /** @scenario "A run that has not finished reads as incomplete" */
    it("is not complete, even when the stored counts match the expected ones", () => {
      const completeness = deriveRunCompleteness({
        ended: false,
        received: { dataset: 2, evaluations: 4 },
        expected: { dataset: 2, evaluations: 4 },
      });

      expect(completeness.complete).toBe(false);
    });
  });

  describe("given a finished run that holds no expected counts", () => {
    /** @scenario "A finished run that reported no counts reads as complete with unknown totals" */
    it("is complete and leaves both totals unknown", () => {
      const completeness = deriveRunCompleteness({
        ended: true,
        received: { dataset: 2, evaluations: 3 },
        expected: { dataset: null, evaluations: null },
      });

      expect(completeness).toEqual({
        complete: true,
        dataset: { received: 2, expected: null },
        evaluations: { received: 3, expected: null },
      });
    });
  });

  describe("given a finished run whose stored verdicts trail the count it reported", () => {
    it("is not complete and counts what is stored against what was reported", () => {
      const completeness = deriveRunCompleteness({
        ended: true,
        received: { dataset: 2, evaluations: 3 },
        expected: { dataset: 2, evaluations: 4 },
      });

      expect(completeness.complete).toBe(false);
      expect(completeness.evaluations).toEqual({ received: 3, expected: 4 });
    });
  });

  describe("given a finished run whose stored rows trail the count it reported", () => {
    it("is not complete", () => {
      const completeness = deriveRunCompleteness({
        ended: true,
        received: { dataset: 1, evaluations: 4 },
        expected: { dataset: 2, evaluations: 4 },
      });

      expect(completeness.complete).toBe(false);
    });
  });
});
