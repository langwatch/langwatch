import { describe, expect, it } from "vitest";
import type { EvaluatorConfig } from "../../types";
import { isComparisonEvaluator } from "../../types";
import {
  isPairwiseConfigured,
  isSelectBestConfigured,
} from "../EvaluationsV3Table";

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

describe("isSelectBestConfigured (#5101)", () => {
  const createSelectBestEvaluator = (
    overrides: Partial<EvaluatorConfig["selectBest"]> = {},
  ): EvaluatorConfig => ({
    id: "eval-select-best-1",
    evaluatorType: "langevals/select_best_compare",
    inputs: [],
    mappings: {},
    selectBest: {
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
        expect(isSelectBestConfigured(createSelectBestEvaluator())).toBe(true);
      });
    });

    describe("when goldenField is unset", () => {
      it("is not configured", () => {
        const evaluator = createSelectBestEvaluator({ goldenField: "" });
        expect(isSelectBestConfigured(evaluator)).toBe(false);
      });
    });
  });

  describe("given hasGoldenAnswer is false", () => {
    describe("when goldenField is unset", () => {
      it("is configured without requiring a golden field", () => {
        const evaluator = createSelectBestEvaluator({
          hasGoldenAnswer: false,
          goldenField: "",
        });
        expect(isSelectBestConfigured(evaluator)).toBe(true);
      });
    });
  });

  describe("given fewer than two variants", () => {
    describe("when only one variant is picked", () => {
      it("is not configured", () => {
        const evaluator = createSelectBestEvaluator({
          variants: ["target-a"],
        });
        expect(isSelectBestConfigured(evaluator)).toBe(false);
      });
    });

    describe("when no variants are picked", () => {
      it("is not configured", () => {
        const evaluator = createSelectBestEvaluator({ variants: [] });
        expect(isSelectBestConfigured(evaluator)).toBe(false);
      });
    });
  });

  describe("given exactly two variants", () => {
    it("is configured, same as a pairwise comparison", () => {
      const evaluator = createSelectBestEvaluator({
        variants: ["target-a", "target-b"],
      });
      expect(isSelectBestConfigured(evaluator)).toBe(true);
    });
  });

  describe("given a non-select-best evaluator", () => {
    it("is not configured regardless of settings", () => {
      const evaluator = createSelectBestEvaluator();
      expect(
        isSelectBestConfigured({
          ...evaluator,
          evaluatorType: "custom/exact_match",
        }),
      ).toBe(false);
    });
  });
});

describe("isComparisonEvaluator", () => {
  describe("given an evaluator that compares target columns", () => {
    it("treats a pairwise evaluator as a comparison", () => {
      expect(isComparisonEvaluator({ pairwise: { variantA: "a" } })).toBe(true);
    });

    it("treats an N-way evaluator as a comparison", () => {
      expect(isComparisonEvaluator({ selectBest: { variants: ["a"] } })).toBe(
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
