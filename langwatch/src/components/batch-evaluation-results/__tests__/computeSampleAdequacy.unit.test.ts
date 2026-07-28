import { describe, expect, it } from "vitest";

import type {
  BTLeaderboard,
  BTLeaderboardEntry,
} from "../computeBTLeaderboard";
import { computeSampleAdequacy } from "../computeSampleAdequacy";

const entry = (
  variantId: string,
  score: number,
  scoreCI: [number, number] | null,
  degenerate = false,
): BTLeaderboardEntry => ({
  variantId,
  wins: 1,
  losses: 1,
  matchups: 2,
  winRate: 0.5,
  strength: 1,
  score,
  scoreCI,
  degenerate,
});

const leaderboard = (
  entries: BTLeaderboardEntry[],
  comparisonCount = 20,
): BTLeaderboard => ({
  entries,
  winMatrix: {},
  comparisonCount,
  minMatchups: 2,
  hasDegenerate: entries.some((e) => e.degenerate),
  didConverge: true,
  comparability: { identifiable: true, groups: [], dominates: [] },
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
        leaderboard([
          entry("a", 100, [-200, 300]),
          entry("b", 50, [-250, 250]),
        ]),
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
          entry("swept", -900, null, true),
        ]),
      );

      expect(adequacy.rankedVariantCount).toBe(2);
      expect(adequacy.totalPairs).toBe(1);
      expect(adequacy.separatedPairs).toBe(1);
    });
  });

  describe("given a single ranked variant", () => {
    it("reports no resolution rather than dividing by zero", () => {
      const adequacy = computeSampleAdequacy(
        leaderboard([entry("a", 0, [-10, 10])]),
      );

      expect(adequacy.totalPairs).toBe(0);
      expect(adequacy.resolution).toBeNull();
    });
  });
});
