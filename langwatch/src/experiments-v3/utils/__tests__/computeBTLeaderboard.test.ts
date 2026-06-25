import { describe, expect, it } from "vitest";
import {
  computeBTLeaderboard,
  type PairwiseComparison,
} from "../computeBTLeaderboard";

/**
 * Build a comparisons list where `winner` beat each `loser` once. Helper
 * keeps the fixture code below readable.
 */
const wins = (
  winner: string,
  losers: string[],
  times = 1,
): PairwiseComparison[] => {
  const out: PairwiseComparison[] = [];
  for (let k = 0; k < times; k++) {
    for (const l of losers) {
      out.push({ candidates: [winner, l], winner });
    }
  }
  return out;
};

const ties = (a: string, b: string, times = 1): PairwiseComparison[] => {
  const out: PairwiseComparison[] = [];
  for (let k = 0; k < times; k++) out.push({ candidates: [a, b], winner: "tie" });
  return out;
};

describe("computeBTLeaderboard", () => {
  it("returns empty leaderboard for empty input", () => {
    const result = computeBTLeaderboard([], []);
    expect(result.entries).toEqual([]);
    expect(result.comparisonCount).toBe(0);
    expect(result.hasDegenerate).toBe(false);
    expect(result.didConverge).toBe(true);
  });

  it("ranks three variants by transitive dominance (no degenerate)", () => {
    // A clearly > B > C, with cross-pair evidence on every edge.
    const data: PairwiseComparison[] = [
      ...wins("A", ["B"], 7),
      ...wins("B", ["A"], 3),
      ...wins("B", ["C"], 7),
      ...wins("C", ["B"], 3),
      ...wins("A", ["C"], 8),
      ...wins("C", ["A"], 2),
    ];
    const result = computeBTLeaderboard(data, ["A", "B", "C"], {
      bootstrapSamples: 0,
    });

    expect(result.hasDegenerate).toBe(false);
    expect(result.didConverge).toBe(true);
    const ranked = result.entries.map((e) => e.variantId);
    expect(ranked).toEqual(["A", "B", "C"]);

    const scoreA = result.entries[0]!.score;
    const scoreB = result.entries[1]!.score;
    const scoreC = result.entries[2]!.score;
    expect(scoreA).toBeGreaterThan(scoreB);
    expect(scoreB).toBeGreaterThan(scoreC);
  });

  it("scores two evenly-matched variants near zero (symmetry)", () => {
    const data: PairwiseComparison[] = [
      ...wins("A", ["B"], 50),
      ...wins("B", ["A"], 50),
    ];
    const result = computeBTLeaderboard(data, ["A", "B"], {
      bootstrapSamples: 0,
    });
    expect(result.entries[0]!.score).toBeCloseTo(0, 6);
    expect(result.entries[1]!.score).toBeCloseTo(0, 6);
    expect(result.entries[0]!.strength).toBeCloseTo(1, 6);
  });

  it("treats ties as 0.5 win + 0.5 loss (LMSYS convention)", () => {
    // Pure ties between A and B → identical scores, half-wins recorded.
    const result = computeBTLeaderboard(ties("A", "B", 20), ["A", "B"], {
      bootstrapSamples: 0,
    });
    expect(result.entries[0]!.wins).toBe(10);
    expect(result.entries[0]!.losses).toBe(10);
    expect(result.entries[0]!.winRate).toBe(0.5);
    expect(result.entries[0]!.score).toBeCloseTo(0, 6);
    expect(result.entries[1]!.score).toBeCloseTo(0, 6);
    // Tie weight present in the matrix.
    expect(result.winMatrix["A"]!["B"]).toBe(10);
    expect(result.winMatrix["B"]!["A"]).toBe(10);
  });

  it("flags variants with no losses as degenerate and still ranks them", () => {
    // A wins every match against B and C; no upsets.
    const data: PairwiseComparison[] = [
      ...wins("A", ["B"], 5),
      ...wins("A", ["C"], 5),
      ...wins("B", ["C"], 3),
      ...wins("C", ["B"], 2),
    ];
    const result = computeBTLeaderboard(data, ["A", "B", "C"], {
      bootstrapSamples: 0,
    });
    expect(result.hasDegenerate).toBe(true);
    const aEntry = result.entries.find((e) => e.variantId === "A")!;
    expect(aEntry.degenerate).toBe(true);
    expect(aEntry.losses).toBe(0);
    // Degenerate sinks past healthy variants — but A still wins on smoothed MLE
    // because B and C are also touched by smoothing. The point is: no crash,
    // finite score.
    expect(Number.isFinite(aEntry.score)).toBe(true);
  });

  it("handles select_best N-way rows (winner beats all other candidates)", () => {
    // Single 3-way row: A wins, contributes 1 vs B and 1 vs C.
    const data: PairwiseComparison[] = [
      { candidates: ["A", "B", "C"], winner: "A" },
      { candidates: ["A", "B", "C"], winner: "A" },
      { candidates: ["A", "B", "C"], winner: "B" },
    ];
    const result = computeBTLeaderboard(data, ["A", "B", "C"], {
      bootstrapSamples: 0,
    });
    expect(result.winMatrix["A"]!["B"]).toBe(2);
    expect(result.winMatrix["A"]!["C"]).toBe(2);
    expect(result.winMatrix["B"]!["A"]).toBe(1);
    expect(result.winMatrix["B"]!["C"]).toBe(1);
    expect(result.comparisonCount).toBe(3);
  });

  it("skips rows with winner=null (pending/error)", () => {
    const data: PairwiseComparison[] = [
      { candidates: ["A", "B"], winner: "A" },
      { candidates: ["A", "B"], winner: null },
      { candidates: ["A", "B"], winner: null },
    ];
    const result = computeBTLeaderboard(data, ["A", "B"], {
      bootstrapSamples: 0,
    });
    expect(result.comparisonCount).toBe(1);
  });

  it("produces deterministic bootstrap CIs for a fixed seed", () => {
    const data: PairwiseComparison[] = [
      ...wins("A", ["B"], 8),
      ...wins("B", ["A"], 4),
    ];
    const r1 = computeBTLeaderboard(data, ["A", "B"], {
      bootstrapSamples: 100,
      seed: 42,
    });
    const r2 = computeBTLeaderboard(data, ["A", "B"], {
      bootstrapSamples: 100,
      seed: 42,
    });
    expect(r1.entries[0]!.scoreCI).not.toBeNull();
    expect(r1.entries[0]!.scoreCI).toEqual(r2.entries[0]!.scoreCI);
    expect(r1.entries[1]!.scoreCI).toEqual(r2.entries[1]!.scoreCI);
  });

  it("returns null CI when bootstrap is disabled", () => {
    const data: PairwiseComparison[] = [
      ...wins("A", ["B"], 5),
      ...wins("B", ["A"], 5),
    ];
    const result = computeBTLeaderboard(data, ["A", "B"], {
      bootstrapSamples: 0,
    });
    expect(result.entries[0]!.scoreCI).toBeNull();
    expect(result.entries[1]!.scoreCI).toBeNull();
  });

  it("exposes minMatchups for sample-size gating", () => {
    // A: 10 matchups, B: 10, C: 4. UI should warn (C < 30).
    const data: PairwiseComparison[] = [
      ...wins("A", ["B"], 5),
      ...wins("B", ["A"], 3),
      ...wins("A", ["C"], 1),
      ...wins("C", ["A"], 1),
      ...wins("B", ["C"], 1),
      ...wins("C", ["B"], 1),
    ];
    const result = computeBTLeaderboard(data, ["A", "B", "C"], {
      bootstrapSamples: 0,
    });
    expect(result.minMatchups).toBe(4);
    const cEntry = result.entries.find((e) => e.variantId === "C")!;
    expect(cEntry.matchups).toBe(4);
  });

  it("ignores comparisons that reference an unknown variant id", () => {
    const data: PairwiseComparison[] = [
      ...wins("A", ["B"]),
      { candidates: ["A", "Z"], winner: "Z" },
    ];
    const result = computeBTLeaderboard(data, ["A", "B"], {
      bootstrapSamples: 0,
    });
    // Z dropped → only the A>B row contributes.
    expect(result.comparisonCount).toBe(2); // both rows were "usable" — filter happens inside buildWinMatrix
    expect(result.winMatrix["A"]!["B"]).toBe(1);
    const aEntry = result.entries.find((e) => e.variantId === "A")!;
    const bEntry = result.entries.find((e) => e.variantId === "B")!;
    expect(aEntry.wins + bEntry.wins).toBe(1);
  });

  it("drops N>2 'tie' rows (semantics ambiguous)", () => {
    const data: PairwiseComparison[] = [
      { candidates: ["A", "B", "C"], winner: "tie" },
      { candidates: ["A", "B"], winner: "tie" },
    ];
    const result = computeBTLeaderboard(data, ["A", "B", "C"], {
      bootstrapSamples: 0,
    });
    // Only the 2-way tie contributes.
    expect(result.winMatrix["A"]!["B"]).toBe(0.5);
    expect(result.winMatrix["B"]!["A"]).toBe(0.5);
    expect(result.winMatrix["A"]!["C"]).toBe(0);
    expect(result.winMatrix["C"]!["A"]).toBe(0);
  });
});
