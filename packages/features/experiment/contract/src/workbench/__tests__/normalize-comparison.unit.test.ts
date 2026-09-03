import { describe, expect, it } from "vitest";
import {
  COMPARISON_EVALUATOR_TYPE,
  type EvaluatorConfig,
  LEGACY_PAIRWISE_EVALUATOR_TYPE,
  type TargetConfig,
} from "../../experiment-workbench";
import {
  normalizeEvaluators,
  normalizeTargets,
  resolveDispatchEvaluatorType,
  resolveVerdictLabel,
  toComparisonConfig,
} from "../normalize-comparison";

const legacyPairwise = {
  variantA: "target-a",
  variantB: "target-b",
  hasGoldenAnswer: true,
  goldenField: "expected_output",
  includeMetrics: [] as ("cost" | "duration")[],
};

describe("toComparisonConfig", () => {
  describe("given a legacy pairwise config", () => {
    it("folds variantA and variantB into an ordered variants list", () => {
      const config = toComparisonConfig({ pairwise: legacyPairwise });

      expect(config?.variants).toEqual(["target-a", "target-b"]);
    });

    // Regression: variantA/variantB used to be `.filter()`ed to drop an
    // empty slot, which collapsed an incomplete config's other slot into
    // position 0 — a stored "A" verdict would then resolve to whatever was
    // in variantB instead of the (missing) variantA. Both positions must
    // survive, even empty, so resolveVariants' own "target not found" guard
    // is what rejects an incomplete config, not a silent position shift.
    describe("when one slot is empty", () => {
      it("keeps the filled slot at its original position instead of shifting it to index 0", () => {
        const config = toComparisonConfig({
          pairwise: { ...legacyPairwise, variantA: "" },
        });

        expect(config?.variants).toEqual(["", "target-b"]);
      });
    });

    it("carries the golden field across", () => {
      const config = toComparisonConfig({ pairwise: legacyPairwise });

      expect(config?.hasGoldenAnswer).toBe(true);
      expect(config?.goldenField).toBe("expected_output");
    });

    describe("when the legacy config opted out of a golden answer", () => {
      it("preserves the opt-out", () => {
        const config = toComparisonConfig({
          pairwise: { ...legacyPairwise, hasGoldenAnswer: false },
        });

        expect(config?.hasGoldenAnswer).toBe(false);
      });
    });

    describe("when the legacy config narrowed structured outputs", () => {
      it("collapses the two slot paths into a per-variant map", () => {
        const config = toComparisonConfig({
          pairwise: {
            ...legacyPairwise,
            variantAOutputPath: ["answer"],
            variantBOutputPath: ["result", "text"],
          },
        });

        expect(config?.variantOutputPaths).toEqual({
          "target-a": ["answer"],
          "target-b": ["result", "text"],
        });
      });
    });

    describe("when only one slot narrowed its output", () => {
      it("maps only that variant", () => {
        const config = toComparisonConfig({
          pairwise: { ...legacyPairwise, variantAOutputPath: ["answer"] },
        });

        expect(config?.variantOutputPaths).toEqual({ "target-a": ["answer"] });
      });
    });

    it("turns on deterministic ordering, the only bias mitigation left", () => {
      const config = toComparisonConfig({ pairwise: legacyPairwise });

      expect(config?.randomizeOrder).toBe(true);
    });
  });

  describe("given a canonical comparison config", () => {
    it("returns it untouched", () => {
      const comparison = {
        variants: ["a", "b", "c"],
        hasGoldenAnswer: false,
        includeMetrics: [] as ("cost" | "duration")[],
        randomizeOrder: false,
      };

      expect(toComparisonConfig({ comparison })).toBe(comparison);
    });

    describe("when both shapes are present", () => {
      it("prefers the canonical one", () => {
        const comparison = {
          variants: ["x", "y", "z"],
          hasGoldenAnswer: true,
          includeMetrics: [] as ("cost" | "duration")[],
          randomizeOrder: true,
        };

        const config = toComparisonConfig({
          comparison,
          pairwise: legacyPairwise,
        });

        expect(config?.variants).toEqual(["x", "y", "z"]);
      });
    });
  });

  describe("given a carrier that is not a comparison", () => {
    it("returns undefined", () => {
      expect(toComparisonConfig({})).toBeUndefined();
    });
  });
});

describe("resolveDispatchEvaluatorType", () => {
  describe("given the legacy pairwise judge type", () => {
    it("reroutes it to the current comparison judge", () => {
      expect(resolveDispatchEvaluatorType(LEGACY_PAIRWISE_EVALUATOR_TYPE)).toBe(
        COMPARISON_EVALUATOR_TYPE,
      );
    });
  });

  describe("given the current comparison judge type", () => {
    it("passes it through untouched", () => {
      expect(resolveDispatchEvaluatorType(COMPARISON_EVALUATOR_TYPE)).toBe(
        COMPARISON_EVALUATOR_TYPE,
      );
    });
  });

  describe("given any other evaluator type", () => {
    it("passes it through untouched", () => {
      expect(resolveDispatchEvaluatorType("langevals/llm_boolean")).toBe("langevals/llm_boolean");
    });
  });

  describe("given undefined", () => {
    it("returns undefined", () => {
      expect(resolveDispatchEvaluatorType(undefined)).toBeUndefined();
    });
  });
});

describe("normalizeEvaluators", () => {
  describe("given an evaluator saved with the legacy shape", () => {
    const evaluators = [
      {
        id: "eval-1",
        evaluatorType: "langevals/pairwise_compare",
        inputs: [],
        mappings: {},
        pairwise: legacyPairwise,
      },
    ] as unknown as EvaluatorConfig[];

    it("rewrites it to the canonical shape", () => {
      const [normalized] = normalizeEvaluators(evaluators);

      expect(normalized?.comparison?.variants).toEqual(["target-a", "target-b"]);
    });

    it("drops the legacy field so nothing writes it back", () => {
      const [normalized] = normalizeEvaluators(evaluators);

      expect(normalized?.pairwise).toBeUndefined();
    });
  });

  describe("given a plain per-row evaluator", () => {
    it("leaves it alone", () => {
      const evaluators = [
        {
          id: "eval-1",
          evaluatorType: "custom/exact_match",
          inputs: [],
          mappings: {},
        },
      ] as unknown as EvaluatorConfig[];

      const [normalized] = normalizeEvaluators(evaluators);

      expect(normalized?.comparison).toBeUndefined();
    });
  });

  /**
   * The shape a saved evaluation really held: an exact-match evaluator that was
   * given a comparison config, so it rendered and ran as a standalone
   * comparison column instead of as a score on every target column.
   */
  describe("given a plain evaluator saved with a comparison config", () => {
    const stored = () =>
      [
        {
          id: "evaluator_q5RPFdOD",
          evaluatorType: "langevals/exact_match",
          inputs: [],
          comparison: {
            variants: ["target-1", "target-2"],
            goldenField: "l3",
            hasGoldenAnswer: true,
            variantOutputPaths: { "target-1": ["output"] },
          },
          mappings: {
            "ds-1": {
              "target-1": {
                output: {
                  type: "source",
                  source: "target",
                  sourceId: "target-1",
                  sourceField: "output",
                },
                expected_output: {
                  type: "source",
                  source: "dataset",
                  sourceId: "ds-1",
                  sourceField: "l3",
                },
              },
            },
          },
          localEvaluatorConfig: { name: "L3 category exact match" },
        },
      ] as unknown as EvaluatorConfig[];

    /** @scenario "A stored comparison config on a plain evaluator is repaired" */
    it("reads back as an evaluator attached to every target column", () => {
      const [normalized] = normalizeEvaluators(stored());

      expect(normalized?.comparison).toBeUndefined();
    });

    /** @scenario "A stored comparison config on a plain evaluator is repaired" */
    it("keeps the per-target mappings, which an attached evaluator already needs", () => {
      const [normalized] = normalizeEvaluators(stored());

      expect(normalized?.mappings).toEqual(stored()[0]!.mappings);
    });

    it("keeps the rest of the evaluator", () => {
      const [normalized] = normalizeEvaluators(stored());

      expect(normalized?.id).toBe("evaluator_q5RPFdOD");
      expect(normalized?.evaluatorType).toBe("langevals/exact_match");
      expect(normalized?.localEvaluatorConfig?.name).toBe("L3 category exact match");
    });
  });

  describe("given the comparison judge with a comparison config", () => {
    it("leaves the standalone comparison column untouched", () => {
      const comparison = {
        variants: ["target-1", "target-2"],
        hasGoldenAnswer: true,
        goldenField: "expected_output",
        includeMetrics: [] as ("cost" | "duration")[],
        randomizeOrder: true,
      };
      const evaluators = [
        {
          id: "evaluator_compare",
          evaluatorType: COMPARISON_EVALUATOR_TYPE,
          inputs: [],
          mappings: {},
          comparison,
        },
      ] as unknown as EvaluatorConfig[];

      const [normalized] = normalizeEvaluators(evaluators);

      expect(normalized?.comparison).toEqual(comparison);
    });
  });
});

describe("normalizeTargets", () => {
  describe("given a legacy pairwise column-target", () => {
    it("rewrites it to the canonical shape", () => {
      const targets = [
        {
          id: "pairwise-target",
          type: "evaluator",
          mappings: {},
          pairwise: legacyPairwise,
        },
      ] as unknown as TargetConfig[];

      const [normalized] = normalizeTargets(targets);

      expect(normalized?.comparison?.variants).toEqual(["target-a", "target-b"]);
      expect(normalized?.pairwise).toBeUndefined();
    });
  });

  describe("given a prompt target saved with a comparison config", () => {
    it("drops the config the target cannot own", () => {
      const targets = [
        {
          id: "prompt-target",
          type: "prompt",
          promptId: "prompt_1",
          mappings: {},
          comparison: {
            variants: ["target-a", "target-b"],
            hasGoldenAnswer: false,
            includeMetrics: [] as ("cost" | "duration")[],
            randomizeOrder: true,
          },
        },
      ] as unknown as TargetConfig[];

      const [normalized] = normalizeTargets(targets);

      // Every comparison edit skips a non-evaluator target, so leaving the
      // field on would give the column an editor that saves nothing.
      expect(normalized?.comparison).toBeUndefined();
      expect(normalized?.type).toBe("prompt");
      expect(normalized?.promptId).toBe("prompt_1");
    });
  });

  describe("given an evaluator target with a comparison config", () => {
    it("keeps it, because that is the target kind a comparison column has", () => {
      const targets = [
        {
          id: "comparison-target",
          type: "evaluator",
          targetEvaluatorId: "db_evaluator_1",
          mappings: {},
          comparison: {
            variants: ["target-a", "target-b"],
            hasGoldenAnswer: false,
            includeMetrics: [] as ("cost" | "duration")[],
            randomizeOrder: true,
          },
        },
      ] as unknown as TargetConfig[];

      const [normalized] = normalizeTargets(targets);

      expect(normalized?.comparison?.variants).toEqual(["target-a", "target-b"]);
    });
  });
});

describe("resolveVerdictLabel", () => {
  const variants = ["target-a", "target-b", "target-c"];

  describe("given a legacy slot label from a run predating the merge", () => {
    it("resolves 'A' to the first variant", () => {
      expect(resolveVerdictLabel({ label: "A", variants })).toBe("target-a");
    });

    it("resolves 'B' to the second variant", () => {
      expect(resolveVerdictLabel({ label: "B", variants })).toBe("target-b");
    });
  });

  describe("given a winner identifier from a current run", () => {
    it("passes it through", () => {
      expect(resolveVerdictLabel({ label: "target-c", variants })).toBe("target-c");
    });
  });

  describe("given a tie", () => {
    it("passes it through", () => {
      expect(resolveVerdictLabel({ label: "tie", variants })).toBe("tie");
    });
  });

  describe("given a slot label with no matching variant", () => {
    it("returns the label rather than inventing a winner", () => {
      expect(resolveVerdictLabel({ label: "B", variants: ["only-one"] })).toBe("B");
    });
  });

  describe("given a variant whose id is literally a slot letter", () => {
    it("names that variant directly rather than slot-mapping to position 0", () => {
      // A current-run label "B" that matches a variant id is that variant, not
      // legacy slot B → must resolve to itself, not variants[0].
      expect(resolveVerdictLabel({ label: "B", variants: ["A", "B", "C"] })).toBe("B");
    });
  });
});
