import { describe, expect, it } from "vitest";
import { buildPairwiseComparisons } from "../buildPairwiseComparisons";
import type { BatchComparisonColumn } from "../types";

const columnWith = (
  verdictsByRow: BatchComparisonColumn["verdictsByRow"],
): BatchComparisonColumn => ({
  evaluatorId: "cmp-1",
  name: "Comparison",
  variants: [
    { id: "variant-a", name: "variant-a" },
    { id: "variant-b", name: "variant-b" },
    { id: "variant-c", name: "variant-c" },
  ],
  verdictsByRow,
});

describe("buildPairwiseComparisons", () => {
  it("maps a winning row to its candidates and winner id", () => {
    const column = columnWith({
      0: {
        rowIndex: 0,
        winnerId: "variant-a",
        candidateIds: ["variant-a", "variant-b", "variant-c"],
      },
    });

    expect(buildPairwiseComparisons(column)).toEqual([
      {
        candidates: ["variant-a", "variant-b", "variant-c"],
        winner: "variant-a",
      },
    ]);
  });

  it('maps a genuine tie to winner: "tie"', () => {
    const column = columnWith({
      0: {
        rowIndex: 0,
        winnerId: null,
        candidateIds: ["variant-a", "variant-b"],
        isUnresolved: false,
      },
    });

    expect(buildPairwiseComparisons(column)).toEqual([
      { candidates: ["variant-a", "variant-b"], winner: "tie" },
    ]);
  });

  it('maps an unresolved label to winner: null, not "tie"', () => {
    const column = columnWith({
      0: {
        rowIndex: 0,
        winnerId: null,
        candidateIds: ["variant-a", "variant-b"],
        isUnresolved: true,
      },
    });

    expect(buildPairwiseComparisons(column)).toEqual([
      { candidates: ["variant-a", "variant-b"], winner: null },
    ]);
  });

  it("uses only the row's own candidates, not the column's full variant list", () => {
    // Row 1 only ever compared two of the column's three variants.
    const column = columnWith({
      0: {
        rowIndex: 0,
        winnerId: "variant-a",
        candidateIds: ["variant-a", "variant-b", "variant-c"],
      },
      1: {
        rowIndex: 1,
        winnerId: "variant-a",
        candidateIds: ["variant-a", "variant-b"],
      },
    });

    const result = buildPairwiseComparisons(column);
    expect(result[1]!.candidates).toEqual(["variant-a", "variant-b"]);
    expect(result[1]!.candidates).not.toContain("variant-c");
  });

  it("falls back to an empty candidate list for legacy rows with none recorded", () => {
    const column = columnWith({
      0: { rowIndex: 0, winnerId: "variant-a" },
    });

    expect(buildPairwiseComparisons(column)).toEqual([
      { candidates: [], winner: "variant-a" },
    ]);
  });
});
