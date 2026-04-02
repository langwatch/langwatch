import { describe, expect, it } from "vitest";
import { availableFilters } from "../registry";

describe("evaluation filter requiresKey wiring", () => {
  describe("when evaluations.passed filter is configured", () => {
    it("references evaluators with has_passed data", () => {
      expect(availableFilters["evaluations.passed"].requiresKey?.filter).toBe(
        "evaluations.evaluator_id.has_passed",
      );
    });
  });

  describe("when evaluations.score filter is configured", () => {
    it("references evaluators with has_score data", () => {
      expect(availableFilters["evaluations.score"].requiresKey?.filter).toBe(
        "evaluations.evaluator_id.has_score",
      );
    });
  });

  describe("when evaluations.label filter is configured", () => {
    it("references evaluators with has_label data", () => {
      expect(availableFilters["evaluations.label"].requiresKey?.filter).toBe(
        "evaluations.evaluator_id.has_label",
      );
    });
  });

  describe("when new filter variants are defined", () => {
    it("defines evaluations.evaluator_id.has_passed", () => {
      expect(availableFilters["evaluations.evaluator_id.has_passed"]).toBeDefined();
      expect(availableFilters["evaluations.evaluator_id.has_passed"].name).toBe(
        "Evaluators with Passed results",
      );
    });

    it("defines evaluations.evaluator_id.has_score", () => {
      expect(availableFilters["evaluations.evaluator_id.has_score"]).toBeDefined();
      expect(availableFilters["evaluations.evaluator_id.has_score"].name).toBe(
        "Evaluators with Score results",
      );
    });

    it("defines evaluations.evaluator_id.has_label", () => {
      expect(availableFilters["evaluations.evaluator_id.has_label"]).toBeDefined();
      expect(availableFilters["evaluations.evaluator_id.has_label"].name).toBe(
        "Evaluators with Label results",
      );
    });
  });

  describe("when existing filters are checked", () => {
    it("preserves evaluations.evaluator_id unchanged", () => {
      expect(availableFilters["evaluations.evaluator_id"]).toBeDefined();
      expect(availableFilters["evaluations.evaluator_id"].name).toBe(
        "Contains Evaluation",
      );
    });

    it("preserves evaluations.evaluator_id.guardrails_only unchanged", () => {
      expect(
        availableFilters["evaluations.evaluator_id.guardrails_only"],
      ).toBeDefined();
      expect(
        availableFilters["evaluations.evaluator_id.guardrails_only"].name,
      ).toBe("Contains Evaluation (guardrails only)");
    });
  });
});
