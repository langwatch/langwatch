import { describe, expect, it } from "vitest";
import {
  computeLeaderboardVerdict,
  findCheaperTiedAlternative,
} from "../computeLeaderboardVerdict";
import type {
  BTLeaderboard,
  BTLeaderboardEntry,
} from "../computeBTLeaderboard";
import type { VariantMetrics } from "../computeVariantMetrics";

const makeEntry = ({
  variantId,
  score,
  scoreCI,
  degenerate = false,
}: {
  variantId: string;
  score: number;
  scoreCI: [number, number] | null;
  degenerate?: boolean;
}): BTLeaderboardEntry => ({
  variantId,
  wins: 10,
  losses: 5,
  matchups: 15,
  winRate: 10 / 15,
  strength: 1,
  score,
  scoreCI,
  degenerate,
});

const makeLeaderboard = (
  entries: BTLeaderboardEntry[],
  overrides: Partial<BTLeaderboard> = {},
): BTLeaderboard => ({
  entries,
  winMatrix: {},
  comparisonCount: 60,
  minMatchups: 15,
  hasDegenerate: entries.some((e) => e.degenerate),
  didConverge: true,
  ...overrides,
});

const makeMetrics = (
  costs: Record<string, number | null>,
): Record<string, VariantMetrics> =>
  Object.fromEntries(
    Object.entries(costs).map(([variantId, avg]) => [
      variantId,
      {
        variantId,
        costStats:
          avg === null ? null : ({ avg } as VariantMetrics["costStats"]),
        durationStats: null,
      },
    ]),
  );

describe("computeLeaderboardVerdict", () => {
  describe("given a top variant whose interval clears every other", () => {
    it("declares a clear winner", () => {
      const leaderboard = makeLeaderboard([
        makeEntry({ variantId: "a", score: 200, scoreCI: [180, 220] }),
        makeEntry({ variantId: "b", score: 100, scoreCI: [80, 120] }),
      ]);

      const verdict = computeLeaderboardVerdict(leaderboard);

      expect(verdict.kind).toBe("clear-winner");
      expect(verdict.leaderId).toBe("a");
      expect(verdict.tiedIds).toEqual(["a"]);
    });
  });

  describe("given a top two whose intervals overlap", () => {
    // The case the ranked table reads as a winner and a runner-up while the
    // run does not actually separate them.
    it("reports a tie rather than crowning the higher score", () => {
      const leaderboard = makeLeaderboard([
        makeEntry({ variantId: "a", score: 142, scoreCI: [124, 160] }),
        makeEntry({ variantId: "b", score: 131, scoreCI: [109, 153] }),
        makeEntry({ variantId: "c", score: 20, scoreCI: [5, 35] }),
      ]);

      const verdict = computeLeaderboardVerdict(leaderboard);

      expect(verdict.kind).toBe("tie-at-top");
      expect(verdict.leaderId).toBe("a");
      expect(verdict.tiedIds).toEqual(["a", "b"]);
    });
  });

  describe("given intervals that touch at exactly one point", () => {
    it("treats them as indistinguishable", () => {
      const leaderboard = makeLeaderboard([
        makeEntry({ variantId: "a", score: 150, scoreCI: [100, 200] }),
        makeEntry({ variantId: "b", score: 50, scoreCI: [200, 250] }),
      ]);

      expect(computeLeaderboardVerdict(leaderboard).kind).toBe("tie-at-top");
    });
  });

  describe("given a variant with no confidence interval", () => {
    // Absence of evidence is not evidence of a difference — the sample was
    // too small to produce an interval, so it cannot be ruled out.
    it("cannot separate it from the leader", () => {
      const leaderboard = makeLeaderboard([
        makeEntry({ variantId: "a", score: 200, scoreCI: [190, 210] }),
        makeEntry({ variantId: "b", score: 10, scoreCI: null }),
      ]);

      const verdict = computeLeaderboardVerdict(leaderboard);

      expect(verdict.kind).toBe("tie-at-top");
      expect(verdict.tiedIds).toEqual(["a", "b"]);
    });
  });

  describe("given no resolved comparisons", () => {
    it("reports no signal", () => {
      const leaderboard = makeLeaderboard(
        [makeEntry({ variantId: "a", score: 0, scoreCI: null })],
        { comparisonCount: 0 },
      );

      const verdict = computeLeaderboardVerdict(leaderboard);

      expect(verdict.kind).toBe("no-signal");
      expect(verdict.leaderId).toBeNull();
    });
  });

  describe("given only degenerate variants", () => {
    it("reports no signal rather than crowning an unscoreable variant", () => {
      const leaderboard = makeLeaderboard([
        makeEntry({
          variantId: "a",
          score: 500,
          scoreCI: null,
          degenerate: true,
        }),
      ]);

      expect(computeLeaderboardVerdict(leaderboard).kind).toBe("no-signal");
    });
  });

  describe("given a degenerate variant alongside real ones", () => {
    it("excludes it from the tie set", () => {
      const leaderboard = makeLeaderboard([
        makeEntry({ variantId: "a", score: 200, scoreCI: [180, 220] }),
        makeEntry({ variantId: "b", score: 100, scoreCI: [80, 120] }),
        makeEntry({
          variantId: "z",
          score: 999,
          scoreCI: null,
          degenerate: true,
        }),
      ]);

      const verdict = computeLeaderboardVerdict(leaderboard);

      expect(verdict.leaderId).toBe("a");
      expect(verdict.tiedIds).not.toContain("z");
    });
  });
});

describe("findCheaperTiedAlternative", () => {
  describe("when two tied variants differ sharply in cost", () => {
    // The whole payoff of reporting ties honestly: same measured quality,
    // so the price is the decision.
    it("recommends the cheaper one", () => {
      const verdict = {
        kind: "tie-at-top" as const,
        leaderId: "a",
        tiedIds: ["a", "b"],
      };
      const result = findCheaperTiedAlternative({
        verdict,
        variantMetrics: makeMetrics({ a: 0.1, b: 0.04 }),
      });

      expect(result?.variantId).toBe("b");
      expect(result?.savingRatio).toBeCloseTo(0.6, 5);
    });
  });

  describe("when several tied variants are cheaper", () => {
    it("recommends the biggest saving", () => {
      const result = findCheaperTiedAlternative({
        verdict: {
          kind: "tie-at-top",
          leaderId: "a",
          tiedIds: ["a", "b", "c"],
        },
        variantMetrics: makeMetrics({ a: 1, b: 0.5, c: 0.2 }),
      });

      expect(result?.variantId).toBe("c");
    });
  });

  describe("when the cost difference is marginal", () => {
    it("stays quiet rather than churning the reader over noise", () => {
      const result = findCheaperTiedAlternative({
        verdict: { kind: "tie-at-top", leaderId: "a", tiedIds: ["a", "b"] },
        variantMetrics: makeMetrics({ a: 1, b: 0.97 }),
      });

      expect(result).toBeNull();
    });
  });

  describe("when the leader is already the cheapest", () => {
    it("recommends nothing", () => {
      const result = findCheaperTiedAlternative({
        verdict: { kind: "tie-at-top", leaderId: "a", tiedIds: ["a", "b"] },
        variantMetrics: makeMetrics({ a: 0.02, b: 0.09 }),
      });

      expect(result).toBeNull();
    });
  });

  describe("when there is a clear winner", () => {
    it("does not suggest trading quality for price", () => {
      const result = findCheaperTiedAlternative({
        verdict: { kind: "clear-winner", leaderId: "a", tiedIds: ["a"] },
        variantMetrics: makeMetrics({ a: 1, b: 0.01 }),
      });

      expect(result).toBeNull();
    });
  });

  describe("when costs are unknown", () => {
    it("recommends nothing rather than guessing", () => {
      const result = findCheaperTiedAlternative({
        verdict: { kind: "tie-at-top", leaderId: "a", tiedIds: ["a", "b"] },
        variantMetrics: makeMetrics({ a: null, b: null }),
      });

      expect(result).toBeNull();
    });
  });
});
