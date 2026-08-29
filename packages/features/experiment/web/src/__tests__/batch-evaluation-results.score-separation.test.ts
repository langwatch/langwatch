import { describe, expect, it } from "vitest";

import {
  type BTLeaderboard,
  type BTLeaderboardEntry,
  computeBTLeaderboard,
  type PairwiseComparison,
  type ScoreDifferenceCI,
} from "@langwatch/experiment-web";
import { areDistinguishable } from "@langwatch/experiment-web";

/**
 * The separation test is the root of every claim this feature makes, so it
 * gets its own tests rather than being covered incidentally through the
 * verdict.
 *
 * @see specs/experiments/comparison-leaderboard.feature
 */

const entry = (
  variantId: string,
  score: number,
  scoreCI: [number, number] | null,
): BTLeaderboardEntry => ({
  variantId,
  wins: 5,
  losses: 5,
  matchups: 10,
  winRate: 0.5,
  strength: 1,
  score,
  scoreCI,
  isDegenerate: false,
});

const intervalsOverlap = (
  a: [number, number] | null,
  b: [number, number] | null,
): boolean => a !== null && b !== null && a[0] <= b[1] && b[0] <= a[1];

describe("areDistinguishable", () => {
  describe("given overlapping intervals but a difference that excludes zero", () => {
    /** @scenario "Two variants are separated on the difference between them" */
    it("reports the pair as separated", () => {
      // The case the whole change exists for. Both variants ride the same
      // resample, so their marginal intervals overlap heavily while every
      // replicate still puts a ahead of b.
      const a = entry("a", 60, [-20, 140]);
      const b = entry("b", 20, [-60, 100]);
      expect(intervalsOverlap(a.scoreCI, b.scoreCI)).toBe(true);

      const separated = areDistinguishable({
        a,
        b,
        differenceCI: { a: { b: [12, 68] }, b: { a: [-68, -12] } },
      });

      expect(separated).toBe(true);
    });
  });

  describe("given a difference interval that spans zero", () => {
    it("reports the pair as not separated", () => {
      expect(
        areDistinguishable({
          a: entry("a", 60, [10, 110]),
          b: entry("b", 20, [-30, 70]),
          differenceCI: { a: { b: [-15, 95] }, b: { a: [-95, 15] } },
        }),
      ).toBe(false);
    });

    it("ignores the marginal intervals even when those would separate", () => {
      // The difference is the answer to the question being asked. If the two
      // disagree the difference wins, or the fallback would be able to
      // override the better statistic.
      const a = entry("a", 200, [150, 250]);
      const b = entry("b", 10, [-40, 40]);
      expect(intervalsOverlap(a.scoreCI, b.scoreCI)).toBe(false);

      expect(
        areDistinguishable({
          a,
          b,
          differenceCI: { a: { b: [-5, 300] }, b: { a: [-300, 5] } },
        }),
      ).toBe(false);
    });
  });

  describe("given a non-finite difference bound", () => {
    it("does not read NaN as a separation", () => {
      // Note this one passes with or without the finiteness guard: every
      // comparison against NaN is false, so the sign test below returns
      // false on its own. Kept for the behaviour, but the Infinity case
      // underneath is what actually exercises the guard.
      expect(
        areDistinguishable({
          a: entry("a", 60, [10, 110]),
          b: entry("b", 20, [-30, 70]),
          differenceCI: { a: { b: [NaN, NaN] }, b: { a: [NaN, NaN] } },
        }),
      ).toBe(false);
    });

    it("does not read an infinite bound as a separation", () => {
      // This is the case the guard exists for. Without it the sign test sees
      // a lower bound of 50 sitting above zero and reports the pair as
      // separated — when an infinite bound means the fit blew up rather than
      // that a real gap was measured. A blown-up replicate is the absence of
      // an answer, not a confident one.
      expect(
        areDistinguishable({
          a: entry("a", 200, [150, 250]),
          b: entry("b", 10, [-40, 40]),
          differenceCI: {
            a: { b: [50, Infinity] },
            b: { a: [-Infinity, -50] },
          },
        }),
      ).toBe(false);
    });

    it("does not read a negative infinite bound as a separation either", () => {
      expect(
        areDistinguishable({
          a: entry("a", 10, [-40, 40]),
          b: entry("b", 200, [150, 250]),
          differenceCI: {
            a: { b: [-Infinity, -50] },
            b: { a: [50, Infinity] },
          },
        }),
      ).toBe(false);
    });
  });

  describe("given the pair asked in the opposite order", () => {
    it("gives the same answer", () => {
      const a = entry("a", 60, [-20, 140]);
      const b = entry("b", 20, [-60, 100]);
      const differenceCI: ScoreDifferenceCI = {
        a: { b: [12, 68] },
        b: { a: [-68, -12] },
      };

      expect(areDistinguishable({ a, b, differenceCI })).toBe(
        areDistinguishable({ a: b, b: a, differenceCI }),
      );
    });
  });

  describe("given no difference intervals at all", () => {
    /** @scenario "Without resamples the run falls back to comparing intervals" */
    it("falls back to comparing the marginal intervals", () => {
      expect(
        areDistinguishable({
          a: entry("a", 200, [150, 250]),
          b: entry("b", 10, [-40, 40]),
          differenceCI: null,
        }),
      ).toBe(true);

      expect(
        areDistinguishable({
          a: entry("a", 60, [-20, 140]),
          b: entry("b", 20, [-60, 100]),
          differenceCI: null,
        }),
      ).toBe(false);
    });

    it("treats a missing interval as no evidence", () => {
      expect(
        areDistinguishable({
          a: entry("a", 200, null),
          b: entry("b", 10, [-40, 40]),
          differenceCI: null,
        }),
      ).toBe(false);
    });
  });
});

const SEEDS = [1, 2, 3, 4, 5, 6];

/** Deterministic pseudo-random four-way verdicts with a known ordering. */
const fourWay = ({ rows, seed }: { rows: number; seed: number }) => {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ids = ["a", "b", "c", "d"];
  const strength = [2.2, 1.6, 1.0, 0.7];
  const total = strength.reduce((s, w) => s + w, 0);
  const pickWinner = () => {
    let pick = rand() * total;
    for (let i = 0; i < ids.length; i++) {
      pick -= strength[i]!;
      if (pick <= 0) return ids[i]!;
    }
    return ids[0]!;
  };
  const comparisons: PairwiseComparison[] = Array.from({ length: rows }, () => ({
    candidates: [...ids],
    winner: pickWinner(),
  }));
  return computeBTLeaderboard({
    comparisons,
    variantIds: ids,
    bootstrapSamples: 300,
    seed,
  });
};

/** Every unordered pair of the variants the fit is entitled to rank. */
const rankedPairs = (lb: BTLeaderboard) => {
  const ranked = lb.entries.filter((e) => !e.isDegenerate);
  return ranked.flatMap((a, i) => ranked.slice(i + 1).map((b) => [a, b] as const));
};

/** The test this feature replaced: do the two marginal intervals miss? */
const separatedByOverlap = (a: BTLeaderboardEntry, b: BTLeaderboardEntry) =>
  !!a.scoreCI && !!b.scoreCI && !intervalsOverlap(a.scoreCI, b.scoreCI);

/** Pairs the overlap test separates but the difference test does not. */
const overlapPairsTheDifferenceMisses = (lb: BTLeaderboard) =>
  rankedPairs(lb)
    .filter(([a, b]) => separatedByOverlap(a, b))
    .filter(([a, b]) => !areDistinguishable({ a, b, differenceCI: lb.scoreDifferenceCI }))
    .map(([a, b]) => `${a.variantId}/${b.variantId}`);

/** How many pairs each of the two tests calls apart, over one fit. */
const countSeparations = (lb: BTLeaderboard) => {
  let byOverlap = 0;
  let byDifference = 0;
  for (const [a, b] of rankedPairs(lb)) {
    if (separatedByOverlap(a, b)) byOverlap++;
    if (areDistinguishable({ a, b, differenceCI: lb.scoreDifferenceCI })) {
      byDifference++;
    }
  }
  return { byOverlap, byDifference };
};

describe("computeBTLeaderboard — the difference intervals it produces", () => {
  describe("given a fitted run", () => {
    it("never separates fewer pairs than comparing the intervals would", () => {
      // Mathematically the overlap test is the strictly stronger condition,
      // so anything it separates the difference must separate too. If this
      // ever fails the two are not measuring the same thing.
      for (const seed of SEEDS) {
        const lb = fourWay({ rows: 60, seed });
        expect(overlapPairsTheDifferenceMisses(lb)).toEqual([]);
      }
    });

    /** @scenario "A difference the run can see is not reported as a tie" */
    it("separates strictly more pairs than comparing the intervals", () => {
      // The reason for the change. Without it the run reports "too close to
      // call" on pairs it demonstrably resolved.
      let byOverlap = 0;
      let byDifference = 0;
      for (const seed of SEEDS) {
        const counts = countSeparations(fourWay({ rows: 60, seed }));
        byOverlap += counts.byOverlap;
        byDifference += counts.byDifference;
      }

      expect(byDifference).toBeGreaterThan(byOverlap);
    });

    it("reports how often the replicate fits failed to settle", () => {
      // Built from a thousand other fits, whose failures used to be dropped.
      const lb = fourWay({ rows: 60, seed: 1 });

      expect(lb.bootstrapNonConvergence).not.toBeNull();
      expect(lb.bootstrapNonConvergence).toBeGreaterThanOrEqual(0);
      expect(lb.bootstrapNonConvergence).toBeLessThanOrEqual(1);
    });

    it("stores each pair in both directions, negated", () => {
      const lb = fourWay({ rows: 60, seed: 1 });
      const ab = lb.scoreDifferenceCI!.a!.b!;
      const ba = lb.scoreDifferenceCI!.b!.a!;

      expect(ba[0]).toBeCloseTo(-ab[1], 9);
      expect(ba[1]).toBeCloseTo(-ab[0], 9);
    });
  });

  describe("given the bootstrap is disabled", () => {
    it("produces no difference intervals to test against", () => {
      const lb = computeBTLeaderboard({
        comparisons: [
          { candidates: ["a", "b"], winner: "a" },
          { candidates: ["a", "b"], winner: "b" },
        ],
        variantIds: ["a", "b"],
        bootstrapSamples: 0,
      });

      expect(lb.scoreDifferenceCI).toBeNull();
    });
  });
});
