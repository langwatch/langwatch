import { describe, expect, it } from "vitest";
import type { EvaluatorConfig, TargetConfig } from "../../types";
import {
  normalizeEvaluators,
  normalizeTargets,
  resolveVerdictLabel,
  toComparisonConfig,
} from "../normalizeComparison";

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

        const config = toComparisonConfig({ comparison, pairwise: legacyPairwise });

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

      expect(normalized?.comparison?.variants).toEqual([
        "target-a",
        "target-b",
      ]);
    });

    it("drops the legacy field so nothing writes it back", () => {
      const [normalized] = normalizeEvaluators(evaluators);

      expect(normalized?.pairwise).toBeUndefined();
    });
  });

  describe("given a plain per-row evaluator", () => {
    it("leaves it alone", () => {
      const evaluators = [
        { id: "eval-1", evaluatorType: "custom/exact_match", inputs: [], mappings: {} },
      ] as unknown as EvaluatorConfig[];

      const [normalized] = normalizeEvaluators(evaluators);

      expect(normalized?.comparison).toBeUndefined();
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

      expect(normalized?.comparison?.variants).toEqual([
        "target-a",
        "target-b",
      ]);
      expect(normalized?.pairwise).toBeUndefined();
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
      expect(resolveVerdictLabel({ label: "target-c", variants })).toBe(
        "target-c",
      );
    });
  });

  describe("given a tie", () => {
    it("passes it through", () => {
      expect(resolveVerdictLabel({ label: "tie", variants })).toBe("tie");
    });
  });

  describe("given a slot label with no matching variant", () => {
    it("returns the label rather than inventing a winner", () => {
      expect(resolveVerdictLabel({ label: "B", variants: ["only-one"] })).toBe(
        "B",
      );
    });
  });

  describe("given a variant whose id is literally a slot letter", () => {
    it("names that variant directly rather than slot-mapping to position 0", () => {
      // A current-run label "B" that matches a variant id is that variant, not
      // legacy slot B → must resolve to itself, not variants[0].
      expect(
        resolveVerdictLabel({ label: "B", variants: ["A", "B", "C"] }),
      ).toBe("B");
    });
  });
});
