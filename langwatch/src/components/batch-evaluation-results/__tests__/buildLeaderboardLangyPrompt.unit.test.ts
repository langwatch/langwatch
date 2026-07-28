import { describe, expect, it } from "vitest";

import { buildLeaderboardLangyPrompt } from "../buildLeaderboardLangyPrompt";

/**
 * The prompt is the only place a claim leaves this feature and is restated by
 * something that can elaborate on it. A rule that is out of date here does not
 * merely go stale — Langy applies it and contradicts the panel beside it.
 *
 * @see specs/experiments/comparison-leaderboard.feature
 */

const entry = (
  variantId: string,
  score: number,
  scoreCI: [number, number] | null,
  degenerate = false,
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
    degenerate,
  }) as any;

const build = ({
  entries,
  scoreDifferenceCI = null,
}: {
  entries: any[];
  scoreDifferenceCI?: any;
}) =>
  buildLeaderboardLangyPrompt({
    comparisonName: "Support showdown",
    headline: { heading: "Ship warm", detail: "It leads." } as any,
    leaderboard: {
      entries,
      winMatrix: {},
      comparisonCount: 60,
      minMatchups: 60,
      hasDegenerate: entries.some((e) => e.degenerate),
      didConverge: true,
      comparability: { identifiable: true, groups: [], dominates: [] },
      scoreDifferenceCI,
      bootstrapNonConvergence: null,
    } as any,
    sampleAdequacy: {
      comparisonCount: 60,
      rankedVariantCount: entries.filter((e) => !e.degenerate).length,
      separatedPairs: 1,
      totalPairs: 1,
      resolution: 1,
      familyWiseFalsePositiveRate: null,
    },
    variantMetrics: {},
    variantNames: { a: "warm", b: "premium" },
    checks: [],
  });

describe("buildLeaderboardLangyPrompt", () => {
  describe("given two variants whose printed ranges overlap but which the run separated", () => {
    const prompt = build({
      entries: [
        entry("a", 60, [-20, 140]),
        entry("b", 20, [-60, 100]),
      ],
      scoreDifferenceCI: { a: { b: [12, 68] }, b: { a: [-68, -12] } },
    });

    it("tells Langy the pair is separated", () => {
      expect(prompt).toContain("warm vs premium: separated");
    });

    it("does not instruct Langy to judge by whether the ranges overlap", () => {
      // The old rule said overlapping ranges are not distinguishable. That
      // was true of the overlap test and is false of the difference test, so
      // leaving it in would have Langy contradict the panel on this exact
      // pair — the ranges DO overlap here and the run still separated them.
      expect(prompt).not.toContain("plausible ranges overlap");
      expect(prompt).toContain("rather than comparing the printed ranges");
    });
  });

  describe("given a pair the run could not separate", () => {
    it("asks Langy not to call either one better", () => {
      const prompt = build({
        entries: [entry("a", 60, [-20, 140]), entry("b", 20, [-60, 100])],
        scoreDifferenceCI: { a: { b: [-15, 95] }, b: { a: [-95, 15] } },
      });

      expect(prompt).toContain("warm vs premium: NOT separated");
      expect(prompt).toContain("don't describe either as better");
    });
  });

  describe("given a degenerate variant", () => {
    it("leaves it out of the pair list, since it cannot be ranked", () => {
      const prompt = build({
        entries: [
          entry("a", 60, [-20, 140]),
          entry("b", 20, [-60, 100]),
          entry("swept", 900, null, true),
        ],
        scoreDifferenceCI: { a: { b: [12, 68] }, b: { a: [-68, -12] } },
      });

      expect(prompt).not.toContain("swept vs");
      expect(prompt).not.toContain("vs swept");
    });
  });

  describe("given a single rankable variant", () => {
    it("says there is nothing to separate rather than listing nothing", () => {
      const prompt = build({ entries: [entry("a", 60, [-20, 140])] });

      expect(prompt).toContain("no pairs to separate");
    });
  });
});
