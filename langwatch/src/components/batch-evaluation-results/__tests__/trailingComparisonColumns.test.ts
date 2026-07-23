import { describe, expect, it } from "vitest";
import { trailingComparisonColumns } from "../SingleRunTable";
import type { BatchComparisonColumn, BatchTargetColumn } from "../types";

const targetColumn = (id: string): BatchTargetColumn => ({
  id,
  name: id,
  type: "prompt",
  outputFields: [],
});

const comparisonColumn = (evaluatorId: string): BatchComparisonColumn => ({
  evaluatorId,
  name: "Comparison",
  variants: [],
  verdictsByRow: {},
});

describe("trailingComparisonColumns", () => {
  describe("given a comparison wired as its own column-target", () => {
    it("renders no trailing column, because the target column holds the verdict", () => {
      const result = trailingComparisonColumns(
        [comparisonColumn("cmp-1")],
        [targetColumn("target-a"), targetColumn("cmp-1")],
      );

      expect(result).toEqual([]);
    });
  });

  describe("given a comparison wired as an evaluator chip", () => {
    // Its chip is suppressed in the target cells, so without a trailing column
    // the verdict has nowhere to render and disappears from the results page.
    it("renders a trailing column so the verdict stays visible", () => {
      const result = trailingComparisonColumns(
        [comparisonColumn("eval-1")],
        [targetColumn("target-a"), targetColumn("target-b")],
      );

      expect(result.map((c) => c.evaluatorId)).toEqual(["eval-1"]);
    });
  });

  describe("given both kinds in one run", () => {
    it("renders a trailing column only for the chip one", () => {
      const result = trailingComparisonColumns(
        [comparisonColumn("cmp-col"), comparisonColumn("eval-chip")],
        [targetColumn("target-a"), targetColumn("cmp-col")],
      );

      expect(result.map((c) => c.evaluatorId)).toEqual(["eval-chip"]);
    });
  });
});
