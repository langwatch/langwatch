import { describe, expect, it } from "vitest";
import {
  closestEvaluatorTypes,
  evaluatorTypeCatalog,
  isValidEvaluatorType,
} from "../catalog";

describe("the CLI's evaluator-type catalog", () => {
  describe("when checking a slug against the catalog", () => {
    /** @scenario The CLI accepts every type the platform's catalog accepts */
    it("accepts langevals catalog types and the platform's native types alike", () => {
      expect(isValidEvaluatorType("ragas/response_relevancy")).toBe(true);
      expect(isValidEvaluatorType("langwatch/api_keys_and_secrets_detection")).toBe(true);
    });

    it("rejects the stale slug the live failure was built on", () => {
      expect(isValidEvaluatorType("ragas/answer_relevancy")).toBe(false);
    });

    it("rejects every legacy-prefixed slug", () => {
      // The CLI validates against the generated platform catalog, so a
      // regeneration that reintroduced the removed family would surface here
      // rather than as a 422 at the API boundary.
      expect(isValidEvaluatorType("legacy/ragas_answer_relevancy")).toBe(false);
      expect(
        evaluatorTypeCatalog().filter((entry) => entry.slug.startsWith("legacy/")),
      ).toEqual([]);
    });
  });

  describe("when ranking the closest types for a miss", () => {
    it("puts the stale ragas slug's live successor first", () => {
      const closest = closestEvaluatorTypes("ragas/answer_relevancy");

      // The rename of the old metric must surface without special-casing.
      expect(closest[0]).toBe("ragas/response_relevancy");
    });

    it("returns only as many suggestions as asked for", () => {
      expect(closestEvaluatorTypes("nonsense", 3)).toHaveLength(3);
    });
  });

  describe("when listing the catalog", () => {
    it("describes every entry well enough to pick from", () => {
      for (const entry of evaluatorTypeCatalog()) {
        expect(entry.slug).toMatch(/^[a-z0-9_-]+\/[a-z0-9_-]+$/);
        expect(entry.name.length).toBeGreaterThan(0);
        expect(entry.category.length).toBeGreaterThan(0);
        expect(typeof entry.isGuardrail).toBe("boolean");
      }
    });
  });
});
