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
  for (let k = 0; k < times; k++)
    out.push({ candidates: [a, b], winner: "tie" });
  return out;
};

describe("computeBTLeaderboard", () => {
  it("returns empty leaderboard for empty input", () => {
    const result = computeBTLeaderboard({
      comparisons: [],
      variantIds: [],
    });
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
    const result = computeBTLeaderboard({
      comparisons: data,
      variantIds: ["A", "B", "C"],
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
    const result = computeBTLeaderboard({
      comparisons: data,
      variantIds: ["A", "B"],
      bootstrapSamples: 0,
    });
    expect(result.entries[0]!.score).toBeCloseTo(0, 6);
    expect(result.entries[1]!.score).toBeCloseTo(0, 6);
    expect(result.entries[0]!.strength).toBeCloseTo(1, 6);
  });

  it("treats ties as 0.5 win + 0.5 loss (LMSYS convention)", () => {
    // Pure ties between A and B → identical scores, half-wins recorded.
    const result = computeBTLeaderboard({
      comparisons: ties("A", "B", 20),
      variantIds: ["A", "B"],
      bootstrapSamples: 0,
    });
    expect(result.entries[0]!.wins).toBe(10);
    expect(result.entries[0]!.losses).toBe(10);
    expect(result.entries[0]!.winRate).toBe(0.5);
    expect(result.entries[0]!.score).toBeCloseTo(0, 6);
    expect(result.entries[1]!.score).toBeCloseTo(0, 6);
    // Tie weight present in the matrix.
    expect(result.winMatrix.A!.B).toBe(10);
    expect(result.winMatrix.B!.A).toBe(10);
  });

  it("flags variants with no losses as degenerate and still ranks them", () => {
    // A wins every match against B and C; no upsets.
    const data: PairwiseComparison[] = [
      ...wins("A", ["B"], 5),
      ...wins("A", ["C"], 5),
      ...wins("B", ["C"], 3),
      ...wins("C", ["B"], 2),
    ];
    const result = computeBTLeaderboard({
      comparisons: data,
      variantIds: ["A", "B", "C"],
      bootstrapSamples: 0,
    });
    expect(result.hasDegenerate).toBe(true);
    const aEntry = result.entries.find((e) => e.variantId === "A")!;
    expect(aEntry.isDegenerate).toBe(true);
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
    const result = computeBTLeaderboard({
      comparisons: data,
      variantIds: ["A", "B", "C"],
      bootstrapSamples: 0,
    });
    expect(result.winMatrix.A!.B).toBe(2);
    expect(result.winMatrix.A!.C).toBe(2);
    expect(result.winMatrix.B!.A).toBe(1);
    expect(result.winMatrix.B!.C).toBe(1);
    expect(result.comparisonCount).toBe(3);
  });

  it("skips rows with winner=null (pending/error)", () => {
    const data: PairwiseComparison[] = [
      { candidates: ["A", "B"], winner: "A" },
      { candidates: ["A", "B"], winner: null },
      { candidates: ["A", "B"], winner: null },
    ];
    const result = computeBTLeaderboard({
      comparisons: data,
      variantIds: ["A", "B"],
      bootstrapSamples: 0,
    });
    expect(result.comparisonCount).toBe(1);
  });

  it("produces deterministic bootstrap CIs for a fixed seed", () => {
    const data: PairwiseComparison[] = [
      ...wins("A", ["B"], 8),
      ...wins("B", ["A"], 4),
    ];
    const r1 = computeBTLeaderboard({
      comparisons: data,
      variantIds: ["A", "B"],
      bootstrapSamples: 100,
      seed: 42,
    });
    const r2 = computeBTLeaderboard({
      comparisons: data,
      variantIds: ["A", "B"],
      bootstrapSamples: 100,
      seed: 42,
    });
    expect(r1.entries[0]!.scoreCI).not.toBeNull();
    expect(r1.entries[0]!.scoreCI).toEqual(r2.entries[0]!.scoreCI);
    expect(r1.entries[1]!.scoreCI).toEqual(r2.entries[1]!.scoreCI);
  });

  describe("when the resample count changes", () => {
    // Guards the wiring between `bootstrapSamples` and the resample loop.
    //
    // The determinism test above cannot: it compares two runs configured
    // identically, so it passes just as happily if `samples` and `seed` are
    // crossed on the way in — both runs are then wrong in the same way. That
    // is not hypothetical; those two arguments were adjacent numbers, and
    // swapping them silently reduces 200 resamples to 1 while still
    // rendering a plausible-looking interval.
    //
    // Sample count leaves a signature a seed cannot fake: `quantile` over a
    // one-element array returns that element for every q, so a single
    // resample collapses the interval to a point, while many resamples must
    // spread it. Asserting on that shape pins which argument is which.
    const data: PairwiseComparison[] = [
      ...wins("A", ["B"], 8),
      ...wins("B", ["A"], 4),
    ];

    it("collapses the interval to a point for a single resample", () => {
      const result = computeBTLeaderboard({
        comparisons: data,
        variantIds: ["A", "B"],
        bootstrapSamples: 1,
        seed: 42,
      });
      const ci = result.entries[0]!.scoreCI;
      expect(ci).not.toBeNull();
      expect(ci![0]).toBe(ci![1]);
    });

    it("spreads the interval for many resamples", () => {
      const result = computeBTLeaderboard({
        comparisons: data,
        variantIds: ["A", "B"],
        bootstrapSamples: 200,
        seed: 42,
      });
      const ci = result.entries[0]!.scoreCI;
      expect(ci).not.toBeNull();
      expect(ci![0]).toBeLessThan(ci![1]);
    });
  });

  it("returns null CI when bootstrap is disabled", () => {
    const data: PairwiseComparison[] = [
      ...wins("A", ["B"], 5),
      ...wins("B", ["A"], 5),
    ];
    const result = computeBTLeaderboard({
      comparisons: data,
      variantIds: ["A", "B"],
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
    const result = computeBTLeaderboard({
      comparisons: data,
      variantIds: ["A", "B", "C"],
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
    const result = computeBTLeaderboard({
      comparisons: data,
      variantIds: ["A", "B"],
      bootstrapSamples: 0,
    });
    // Z dropped → only the A>B row contributes, and the count says so.
    //
    // This used to assert 2, on the grounds that both rows passed the
    // `winner !== null` filter and the real drop happened later inside
    // buildWinMatrix. But comparisonCount is what the UI narrates as "based
    // on N comparisons" and what it actually ranked on, so counting a row that
    // contributed no evidence overstated the run to the reader.
    expect(result.comparisonCount).toBe(1);
    expect(result.winMatrix.A!.B).toBe(1);
    const aEntry = result.entries.find((e) => e.variantId === "A")!;
    const bEntry = result.entries.find((e) => e.variantId === "B")!;
    expect(aEntry.wins + bEntry.wins).toBe(1);
  });

  it("drops N>2 'tie' rows (semantics ambiguous)", () => {
    const data: PairwiseComparison[] = [
      { candidates: ["A", "B", "C"], winner: "tie" },
      { candidates: ["A", "B"], winner: "tie" },
    ];
    const result = computeBTLeaderboard({
      comparisons: data,
      variantIds: ["A", "B", "C"],
      bootstrapSamples: 0,
    });
    // Only the 2-way tie contributes.
    expect(result.winMatrix.A!.B).toBe(0.5);
    expect(result.winMatrix.B!.A).toBe(0.5);
    expect(result.winMatrix.A!.C).toBe(0);
    expect(result.winMatrix.C!.A).toBe(0);
  });
});

describe("computeBTLeaderboard bootstrap stability", () => {
  describe("given a small sample where a resample can wipe out a variant's wins", () => {
    // The regime this feature explicitly warns about (under 30 matchups) was
    // the regime where the interval was fabricated: a replicate containing a
    // zero-win variant sent its score to -Infinity and its opponent's to
    // ~+120000. Those bounds are FINITE, so isFinite() guards downstream let
    // them through, and the verdict then reads every pair as overlapping.
    const comparisons = [
      ...Array.from({ length: 8 }, () => ({
        candidates: ["a", "b"],
        winner: "a",
      })),
      ...Array.from({ length: 2 }, () => ({
        candidates: ["a", "b"],
        winner: "b",
      })),
    ];

    it("produces intervals that stay within a plausible range", () => {
      const result = computeBTLeaderboard({
        comparisons: comparisons,
        variantIds: ["a", "b"],
        bootstrapSamples: 200,
        seed: 1,
      });

      for (const entry of result.entries) {
        expect(entry.scoreCI).not.toBeNull();
        const [lower, upper] = entry.scoreCI!;
        expect(Number.isFinite(lower)).toBe(true);
        expect(Number.isFinite(upper)).toBe(true);
        // Elo-style points. Anything past a few thousand is divergence, not
        // uncertainty — the pre-fix values were ~60000.
        expect(Math.abs(lower)).toBeLessThan(2000);
        expect(Math.abs(upper)).toBeLessThan(2000);
      }
    });

    it("keeps the interval ordered", () => {
      const result = computeBTLeaderboard({
        comparisons: comparisons,
        variantIds: ["a", "b"],
        bootstrapSamples: 200,
        seed: 1,
      });

      for (const entry of result.entries) {
        const [lower, upper] = entry.scoreCI!;
        expect(lower).toBeLessThanOrEqual(upper);
      }
    });
  });
});

describe("computeBTLeaderboard — the Elo scale the UI promises", () => {
  describe("given one variant with ten-to-one odds over another", () => {
    it("puts exactly 400 points between them", () => {
      // Step 1's help text tells the reader "A 400-point gap is roughly 10:1
      // odds; 0 is a coin flip". That promise rests entirely on the 400 in
      // `400 * Math.log10(strength)`, and nothing was holding it — halving
      // the constant rescaled every score in the product while every test
      // still passed, quietly making the sentence false.
      const comparisons = [
        ...Array.from({ length: 100 }, () => ({
          candidates: ["a", "b"],
          winner: "a",
        })),
        ...Array.from({ length: 10 }, () => ({
          candidates: ["a", "b"],
          winner: "b",
        })),
      ];

      const leaderboard = computeBTLeaderboard({
        comparisons,
        variantIds: ["a", "b"],
        bootstrapSamples: 0,
      });

      const a = leaderboard.entries.find((e) => e.variantId === "a")!;
      const b = leaderboard.entries.find((e) => e.variantId === "b")!;

      // 100:10 wins means the fitted strengths sit at 10:1, and
      // 400 * log10(10) is 400.
      expect(a.strength / b.strength).toBeCloseTo(10, 4);
      expect(a.score - b.score).toBeCloseTo(400, 3);
    });
  });

  describe("given two variants that split their matchups evenly", () => {
    it("puts them both at zero, the coin-flip the same sentence promises", () => {
      const comparisons = [
        ...Array.from({ length: 20 }, () => ({
          candidates: ["a", "b"],
          winner: "a",
        })),
        ...Array.from({ length: 20 }, () => ({
          candidates: ["a", "b"],
          winner: "b",
        })),
      ];

      const leaderboard = computeBTLeaderboard({
        comparisons,
        variantIds: ["a", "b"],
        bootstrapSamples: 0,
      });

      for (const entry of leaderboard.entries) {
        expect(entry.score).toBeCloseTo(0, 6);
      }
    });
  });
});
