import { describe, expect, it } from "vitest";
import type { EvaluatorConfig } from "../../types";
import { isComparisonEvaluator } from "../../types";
import { isComparisonConfigured } from "../EvaluationsV3Table";

describe("isComparisonConfigured, given a legacy pairwise config", () => {
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
        expect(isComparisonConfigured(createPairwiseEvaluator())).toBe(true);
      });
    });

    describe("when goldenField is unset", () => {
      it("is not configured", () => {
        const evaluator = createPairwiseEvaluator({ goldenField: "" });
        expect(isComparisonConfigured(evaluator)).toBe(false);
      });
    });

    describe("when hasGoldenAnswer is omitted (legacy config)", () => {
      it("still requires a golden field", () => {
        const evaluator = createPairwiseEvaluator({
          hasGoldenAnswer: undefined,
          goldenField: "",
        });
        expect(isComparisonConfigured(evaluator)).toBe(false);
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
        expect(isComparisonConfigured(evaluator)).toBe(true);
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
        expect(isComparisonConfigured(evaluator)).toBe(false);
      });
    });
  });

  describe("given both variants and a golden field", () => {
    it("normalizes to two variants and is configured", () => {
      expect(isComparisonConfigured(createPairwiseEvaluator())).toBe(true);
    });
  });
});

describe("isComparisonConfigured", () => {
  const createComparisonEvaluator = (
    overrides: Partial<EvaluatorConfig["comparison"]> = {},
  ): EvaluatorConfig => ({
    id: "eval-comparison-1",
    evaluatorType: "langevals/select_best_compare",
    inputs: [],
    mappings: {},
    comparison: {
      variants: ["target-a", "target-b", "target-c"],
      hasGoldenAnswer: true,
      goldenField: "expected_output",
      includeMetrics: [],
      randomizeOrder: true,
      ...overrides,
    },
  });

  describe("given hasGoldenAnswer is true", () => {
    describe("when goldenField is set and there are 3 variants", () => {
      it("is configured", () => {
        expect(isComparisonConfigured(createComparisonEvaluator())).toBe(true);
      });
    });

    describe("when goldenField is unset", () => {
      it("is not configured", () => {
        const evaluator = createComparisonEvaluator({ goldenField: "" });
        expect(isComparisonConfigured(evaluator)).toBe(false);
      });
    });
  });

  describe("given hasGoldenAnswer is false", () => {
    describe("when goldenField is unset", () => {
      it("is configured without requiring a golden field", () => {
        const evaluator = createComparisonEvaluator({
          hasGoldenAnswer: false,
          goldenField: "",
        });
        expect(isComparisonConfigured(evaluator)).toBe(true);
      });
    });
  });

  describe("given fewer than two variants", () => {
    describe("when only one variant is picked", () => {
      it("is not configured", () => {
        const evaluator = createComparisonEvaluator({
          variants: ["target-a"],
        });
        expect(isComparisonConfigured(evaluator)).toBe(false);
      });
    });

    describe("when no variants are picked", () => {
      it("is not configured", () => {
        const evaluator = createComparisonEvaluator({ variants: [] });
        expect(isComparisonConfigured(evaluator)).toBe(false);
      });
    });
  });

  describe("given exactly two variants", () => {
    it("is configured, same as a pairwise comparison", () => {
      const evaluator = createComparisonEvaluator({
        variants: ["target-a", "target-b"],
      });
      expect(isComparisonConfigured(evaluator)).toBe(true);
    });
  });

  // Configuration is read off the comparison config, not the evaluatorType —
  // that is what lets a legacy pairwise evaluator render the same column.
  describe("given an evaluator with no comparison config", () => {
    it("is not configured", () => {
      const evaluator = {
        id: "eval-1",
        evaluatorType: "custom/exact_match",
        inputs: [],
        mappings: {},
      } as unknown as EvaluatorConfig;
      expect(isComparisonConfigured(evaluator)).toBe(false);
    });
  });
});

describe("isComparisonEvaluator", () => {
  describe("given an evaluator that compares target columns", () => {
    it("treats a pairwise evaluator as a comparison", () => {
      expect(isComparisonEvaluator({ pairwise: { variantA: "a" } })).toBe(true);
    });

    it("treats a comparison evaluator as a comparison", () => {
      expect(isComparisonEvaluator({ comparison: { variants: ["a"] } })).toBe(
        true,
      );
    });
  });

  describe("given a plain per-row evaluator", () => {
    it("is not a comparison, so it still renders as a target chip", () => {
      expect(isComparisonEvaluator({})).toBe(false);
    });
  });
});
