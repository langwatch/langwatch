import { describe, expect, it } from "vitest";
import type { EvaluatorConfig, TargetConfig } from "../../types";
import { createInitialResults, isComparisonEvaluator } from "../../types";
import {
  buildTargetEvaluatorsForRow,
  isComparisonConfigured,
} from "../EvaluationsV3Table";

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

describe("buildTargetEvaluatorsForRow", () => {
  const comparisonTarget: TargetConfig = {
    id: "target-comparison-1",
    type: "evaluator",
    targetEvaluatorId: "eval-comparison-1",
    inputs: [],
    outputs: [],
    mappings: {},
    comparison: {
      variants: ["target-a", "target-b"],
      hasGoldenAnswer: true,
      goldenField: "expected_output",
      includeMetrics: [],
      randomizeOrder: true,
    },
  };

  const plainTarget: TargetConfig = {
    id: "target-a",
    type: "prompt",
    inputs: [],
    outputs: [],
    mappings: {},
  };

  const gradingEvaluator: EvaluatorConfig = {
    id: "eval-grading-1",
    evaluatorType: "langevals/exact_match",
    inputs: [],
    mappings: {},
  };

  // Regression: this row-shaping code once checked the raw `target.pairwise`
  // field to decide whether to self-key a column-target comparison's row
  // data. normalizeTargets rewrites `pairwise` to `comparison` at load, so
  // that check was always false post-normalization — every column-target
  // comparison silently rendered "No verdict yet" for every row despite the
  // orchestrator having written real judge verdicts.
  describe("given a column-target comparison (target.type is evaluator with a comparison config)", () => {
    it("self-keys the row's verdict under the target's own id", () => {
      const results = createInitialResults();
      results.evaluatorResults[comparisonTarget.id] = {
        [comparisonTarget.id]: [{ status: "processed", label: "target-a" }],
      };

      const evaluators = buildTargetEvaluatorsForRow(
        comparisonTarget,
        [],
        results,
        0,
      );

      expect(evaluators[comparisonTarget.id]).toEqual({
        status: "processed",
        label: "target-a",
      });
    });

    describe("when the row has no result yet", () => {
      it("resolves to null rather than being dropped", () => {
        const results = createInitialResults();

        const evaluators = buildTargetEvaluatorsForRow(
          comparisonTarget,
          [],
          results,
          0,
        );

        expect(evaluators[comparisonTarget.id]).toBeNull();
      });
    });
  });

  describe("given a plain target with a per-row grading evaluator", () => {
    it("keys the row's result under the evaluator's id, not the target's", () => {
      const results = createInitialResults();
      results.evaluatorResults[plainTarget.id] = {
        [gradingEvaluator.id]: [{ status: "processed", passed: true }],
      };

      const evaluators = buildTargetEvaluatorsForRow(
        plainTarget,
        [gradingEvaluator],
        results,
        0,
      );

      expect(evaluators[gradingEvaluator.id]).toEqual({
        status: "processed",
        passed: true,
      });
      expect(evaluators[plainTarget.id]).toBeUndefined();
    });
  });
});
