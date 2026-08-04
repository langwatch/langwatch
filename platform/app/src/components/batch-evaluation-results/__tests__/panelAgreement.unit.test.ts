import { describe, expect, it } from "vitest";

import { computeLeaderboardVerdict } from "../computeLeaderboardVerdict";
import { computeParetoDominance } from "../computeParetoDominance";
import { computeSampleAdequacy } from "../computeSampleAdequacy";
import { areDistinguishable } from "../scoreSeparation";

/**
 * Three panels answer the same question — which pairs did this run separate?
 * The verdict builds its tie set from it, the trust panel counts it, and the
 * trade-off summary gates its quality comparison on it.
 *
 * They were computed independently once and drifted: the verdict named a
 * clear winner while the adequacy panel beside it reported zero separated
 * pairs, both on screen at the same time. Consolidating them into
 * `scoreSeparation` fixed that, but nothing pinned the three together
 * afterwards — so a future change could silently split them again.
 *
 * @see specs/experiments/comparison-leaderboard.feature
 */

const entry = (
  variantId: string,
  score: number,
  scoreCI: [number, number] | null,
) =>
  ({
    variantId,
    wins: 5,
    losses: 5,
    matchups: 10,
    winRate: 0.5,
    strength: 1,
    score,
    scoreCI,
    isDegenerate: false,
  }) as any;

/**
 * Deliberately a case where the two answers DIVERGE: every pair's printed
 * range overlaps its neighbour's, so the old overlap test would separate
 * nothing, while the difference intervals separate a–c and b–c. A fixture
 * where both tests agree would pass even if a panel reverted.
 */
const leaderboard = {
  entries: [
    entry("a", 120, [20, 220]),
    entry("b", 100, [0, 200]),
    entry("c", 10, [-90, 110]),
  ],
  winMatrix: {},
  comparisonCount: 60,
  minMatchups: 60,
  hasDegenerate: false,
  didConverge: true,
  comparability: { identifiable: true, groups: [], dominates: [] },
  scoreDifferenceCI: {
    a: { b: [-15, 55], c: [40, 180] },
    b: { a: [-55, 15], c: [25, 155] },
    c: { a: [-180, -40], b: [-155, -25] },
  },
  bootstrapNonConvergence: null,
} as any;

const variantMetrics = {
  a: {
    variantId: "a",
    costStats: { avg: 0.002, count: 60 },
    durationStats: { avg: 1000, count: 60 },
    costMeanCI: null,
    durationMeanCI: null,
    costDifferenceCI: {},
    durationDifferenceCI: {},
  },
  b: {
    variantId: "b",
    costStats: { avg: 0.002, count: 60 },
    durationStats: { avg: 1000, count: 60 },
    costMeanCI: null,
    durationMeanCI: null,
    costDifferenceCI: {},
    durationDifferenceCI: {},
  },
  c: {
    variantId: "c",
    costStats: { avg: 0.002, count: 60 },
    durationStats: { avg: 1000, count: 60 },
    costMeanCI: null,
    durationMeanCI: null,
    costDifferenceCI: {},
    durationDifferenceCI: {},
  },
} as any;

/** The separation answer, taken straight from the shared test. */
const separatedPairs = () => {
  const ranked = leaderboard.entries;
  const pairs: string[] = [];
  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      if (
        areDistinguishable({
          a: ranked[i]!,
          b: ranked[j]!,
          differenceCI: leaderboard.scoreDifferenceCI,
        })
      ) {
        pairs.push(`${ranked[i]!.variantId}-${ranked[j]!.variantId}`);
      }
    }
  }
  return pairs;
};

describe("the panels agree on which pairs were separated", () => {
  describe("given a run where the difference test and the overlap test disagree", () => {
    /** @scenario "Every panel agrees on which pairs were separated" */
    it("separates exactly the pairs the shared test says it does", () => {
      // Sanity: if this fixture ever stops exercising the divergence, the
      // agreement checks below become vacuous.
      expect(separatedPairs()).toEqual(["a-c", "b-c"]);
    });

    it("counts the same number in the trust panel", () => {
      expect(computeSampleAdequacy(leaderboard).separatedPairs).toBe(
        separatedPairs().length,
      );
    });

    it("builds the verdict's tie set from the same answer", () => {
      // a and b are not separated, so both are tied at the top; c is
      // separated from both and must be excluded.
      const verdict = computeLeaderboardVerdict(leaderboard);

      expect(verdict.kind).toBe("tie-at-top");
      expect(verdict.tiedIds).toEqual(["a", "b"]);
      expect(verdict.tiedIds).not.toContain("c");
    });

    it("gates the trade-off summary's quality comparison on the same answer", () => {
      // Cost and duration are identical across the field, so any dominance
      // here can only have come from the quality comparison — which must
      // agree with the pairs above.
      const dominance = computeParetoDominance({ leaderboard, variantMetrics });

      expect(dominance.dominatedBy.c).toEqual(["a", "b"]);
      expect(dominance.dominatedBy.a).toEqual([]);
      expect(dominance.dominatedBy.b).toEqual([]);
    });

    it("never lets the verdict crown someone the count says is unsettled", () => {
      // The exact shape of the original drift: a clear winner announced
      // beside a panel reporting nothing separated.
      const verdict = computeLeaderboardVerdict(leaderboard);
      const adequacy = computeSampleAdequacy(leaderboard);

      if (verdict.kind === "clear-winner") {
        expect(adequacy.separatedPairs).toBe(adequacy.totalPairs);
      }
      expect(verdict.tiedIds.length + adequacy.separatedPairs).toBeGreaterThan(
        0,
      );
    });
  });
});
