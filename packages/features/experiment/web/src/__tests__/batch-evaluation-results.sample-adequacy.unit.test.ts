import { describe, expect, it } from "vitest";

import type { BTLeaderboard, BTLeaderboardEntry } from "@langwatch/experiment-web";
import { computeSampleAdequacy } from "@langwatch/experiment-web";

const entry = (
  variantId: string,
  score: number,
  scoreCI: [number, number] | null,
): BTLeaderboardEntry => ({
  variantId,
  wins: 1,
  losses: 1,
  matchups: 2,
  winRate: 0.5,
  strength: 1,
  score,
  scoreCI,
  isDegenerate: false,
});

/** A variant that swept or was swept: no score the fit can defend. */
const degenerateEntry = (
  variantId: string,
  score: number,
  scoreCI: [number, number] | null,
): BTLeaderboardEntry => ({
  ...entry(variantId, score, scoreCI),
  isDegenerate: true,
});

const leaderboard = (entries: BTLeaderboardEntry[], comparisonCount = 20): BTLeaderboard => ({
  entries,
  winMatrix: {},
  comparisonCount,
  minMatchups: 2,
  hasDegenerate: entries.some((e) => e.isDegenerate),
  didConverge: true,
  comparability: { identifiable: true, groups: [], dominates: [] },
  // No replicates, so separation falls back to comparing the marginal
  // intervals — which is what these expectations were written against.
  scoreDifferenceCI: null,
  bootstrapNonConvergence: null,
});

describe("computeSampleAdequacy", () => {
  describe("given three variants the run fully separates", () => {
    it("reports every pair as separated", () => {
      const adequacy = computeSampleAdequacy(
        leaderboard([
          entry("a", 200, [150, 250]),
          entry("b", 0, [-50, 50]),
          entry("c", -200, [-250, -150]),
        ]),
      );

      expect(adequacy.rankedVariantCount).toBe(3);
      expect(adequacy.totalPairs).toBe(3);
      expect(adequacy.separatedPairs).toBe(3);
      expect(adequacy.resolution).toBe(1);
    });
  });

  describe("given a run where the top two overlap", () => {
    /** @scenario "Sample size is reported as observed, never as a forecast" */
    it("counts only the pairs that were actually separated", () => {
      const adequacy = computeSampleAdequacy(
        leaderboard([
          entry("a", 150, [50, 250]),
          entry("b", 130, [40, 230]),
          entry("c", -200, [-300, -100]),
        ]),
      );

      // a-b overlap; a-c and b-c do not.
      expect(adequacy.separatedPairs).toBe(2);
      expect(adequacy.totalPairs).toBe(3);
    });
  });

  describe("given a run that separates nothing", () => {
    it("reports zero resolution rather than an order", () => {
      const adequacy = computeSampleAdequacy(
        leaderboard([entry("a", 100, [-200, 300]), entry("b", 50, [-250, 250])]),
      );

      expect(adequacy.separatedPairs).toBe(0);
      expect(adequacy.resolution).toBe(0);
    });
  });

  describe("when a variant has no confidence interval", () => {
    it("treats the pair as unseparated rather than as a difference", () => {
      const adequacy = computeSampleAdequacy(
        leaderboard([entry("a", 200, null), entry("b", -200, [-250, -150])]),
      );

      expect(adequacy.separatedPairs).toBe(0);
    });
  });

  describe("when a bootstrap returned a non-finite bound", () => {
    it("treats the pair as unseparated rather than trusting the interval", () => {
      const adequacy = computeSampleAdequacy(
        leaderboard([
          entry("a", 200, [150, Number.POSITIVE_INFINITY]),
          entry("b", -200, [-250, -150]),
        ]),
      );

      expect(adequacy.separatedPairs).toBe(0);
    });
  });

  describe("given a degenerate variant", () => {
    it("excludes it from the pair count entirely", () => {
      const adequacy = computeSampleAdequacy(
        leaderboard([
          entry("a", 200, [150, 250]),
          entry("b", -200, [-250, -150]),
          degenerateEntry("swept", -900, null),
        ]),
      );

      expect(adequacy.rankedVariantCount).toBe(2);
      expect(adequacy.totalPairs).toBe(1);
      expect(adequacy.separatedPairs).toBe(1);
    });
  });

  describe("given a single ranked variant", () => {
    it("reports no resolution rather than dividing by zero", () => {
      const adequacy = computeSampleAdequacy(leaderboard([entry("a", 0, [-10, 10])]));

      expect(adequacy.totalPairs).toBe(0);
      expect(adequacy.resolution).toBeNull();
    });
  });
});

describe("computeSampleAdequacy — when multiplicity is worth raising", () => {
  const rankable = (ids: string[]): BTLeaderboardEntry[] =>
    ids.map((variantId) => ({
      variantId,
      wins: 5,
      losses: 5,
      matchups: 10,
      winRate: 0.5,
      strength: 1,
      score: 0,
      scoreCI: [-10, 10],
      isDegenerate: false,
    }));

  const board = (ids: string[]): BTLeaderboard => ({
    entries: rankable(ids),
    winMatrix: {},
    comparisonCount: 60,
    minMatchups: 60,
    hasDegenerate: false,
    didConverge: true,
    comparability: { identifiable: true, groups: [], dominates: [] },
    scoreDifferenceCI: null,
    bootstrapNonConvergence: null,
  });

  describe("given only one pair", () => {
    it("reports no multiplicity, because one test is not several", () => {
      // The gating lives here, not in the panel: the panel test supplies the
      // rate directly, so it would keep passing if this returned 5% for a
      // single pair — which reads as "across 1 pairs there is a 5% chance",
      // a caveat about nothing.
      expect(computeSampleAdequacy(board(["a", "b"])).familyWiseFalsePositiveRate).toBeNull();
    });
  });

  describe("given several pairs", () => {
    /** @scenario "The count of separated pairs states its own multiplicity" */
    it("reports the chance that at least one separated by luck", () => {
      const adequacy = computeSampleAdequacy(board(["a", "b", "c"]));

      expect(adequacy.totalPairs).toBe(3);
      expect(adequacy.familyWiseFalsePositiveRate).toBeCloseTo(1 - Math.pow(0.95, 3), 10);
    });

    it("grows as more pairs are tested", () => {
      const three = computeSampleAdequacy(board(["a", "b", "c"]));
      const four = computeSampleAdequacy(board(["a", "b", "c", "d"]));

      expect(four.familyWiseFalsePositiveRate!).toBeGreaterThan(three.familyWiseFalsePositiveRate!);
    });
  });
});
