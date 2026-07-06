import { describe, expect, it } from "vitest";
import type { EvaluatorConfig } from "../../types";
import { isPairwiseConfigured } from "../EvaluationsV3Table";

describe("isPairwiseConfigured (#5378)", () => {
  const createPairwiseEvaluator = (
    overrides: Partial<EvaluatorConfig["pairwise"]> = {},
  ): EvaluatorConfig => ({
    id: "eval-pairwise-1",
    evaluatorType: "langevals/pairwise_compare",
    inputs: [],
    mappings: {},
    pairwise: {
      variantA: "target-a",
      variantB: "target-b",
      hasGoldenAnswer: true,
      goldenField: "expected_output",
      includeMetrics: [],
      ...overrides,
    },
  });

  describe("given hasGoldenAnswer is true", () => {
    describe("when goldenField is set", () => {
      it("is configured", () => {
        expect(isPairwiseConfigured(createPairwiseEvaluator())).toBe(true);
      });
    });

    describe("when goldenField is unset", () => {
      it("is not configured", () => {
        const evaluator = createPairwiseEvaluator({ goldenField: "" });
        expect(isPairwiseConfigured(evaluator)).toBe(false);
      });
    });

    describe("when hasGoldenAnswer is omitted (legacy config)", () => {
      it("still requires a golden field", () => {
        const evaluator = createPairwiseEvaluator({
          hasGoldenAnswer: undefined,
          goldenField: "",
        });
        expect(isPairwiseConfigured(evaluator)).toBe(false);
      });
    });
  });

  describe("given hasGoldenAnswer is false", () => {
    describe("when goldenField is unset", () => {
      it("is configured without requiring a golden field", () => {
        const evaluator = createPairwiseEvaluator({
          hasGoldenAnswer: false,
          goldenField: "",
        });
        expect(isPairwiseConfigured(evaluator)).toBe(true);
      });
    });

    describe("when variantA/variantB are unset", () => {
      it("is still not configured", () => {
        const evaluator = createPairwiseEvaluator({
          hasGoldenAnswer: false,
          goldenField: "",
          variantA: "",
          variantB: "",
        });
        expect(isPairwiseConfigured(evaluator)).toBe(false);
      });
    });
  });

  describe("given a non-pairwise evaluator", () => {
    it("is not configured regardless of settings", () => {
      const evaluator = createPairwiseEvaluator();
      expect(
        isPairwiseConfigured({
          ...evaluator,
          evaluatorType: "custom/exact_match",
        }),
      ).toBe(false);
    });
  });
});
