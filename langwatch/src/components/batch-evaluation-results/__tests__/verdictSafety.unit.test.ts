import { describe, expect, it } from "vitest";

import { computeBTLeaderboard } from "../computeBTLeaderboard";
import { computeLeaderboardVerdict } from "../computeLeaderboardVerdict";
import { computeSampleAdequacy } from "../computeSampleAdequacy";

/**
 * The verdict is the one thing in this feature a reader acts on, so these pin
 * the shapes where it previously stated something the run did not support.
 * Each came out of an adversarial audit and each fails without its fix.
 *
 * @see specs/experiments/comparison-leaderboard.feature
 */

const wins = (winner: string, loser: string, times: number) =>
  Array.from({ length: times }, () => ({
    candidates: [winner, loser],
    winner,
  }));

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

const board = (entries: any[]) =>
  ({
    entries,
    winMatrix: {},
    comparisonCount: 60,
    minMatchups: 60,
    hasDegenerate: entries.some((e) => e.degenerate),
    didConverge: true,
    comparability: { identifiable: true, groups: [], dominates: [] },
  }) as any;

describe("computeLeaderboardVerdict — claims it must not make", () => {
  describe("given a strict order where the leader swept and the tail was swept", () => {
    it("refuses to crown the variant that lost every match it played", () => {
      // a > b > c. Both a and c are degenerate (a never lost, c never won),
      // so the rankable field collapses to b alone. That used to satisfy
      // "nothing could be separated from the leader" and produced
      // "Ship b" — b having lost every single match to a, which the table
      // above displayed at a 100% win rate.
      const leaderboard = computeBTLeaderboard({
        comparisons: [...wins("a", "b", 3), ...wins("b", "c", 3)],
        variantIds: ["a", "b", "c"],
        bootstrapSamples: 0,
      });

      expect(leaderboard.entries.filter((e) => !e.degenerate)).toHaveLength(1);

      const verdict = computeLeaderboardVerdict(leaderboard);

      expect(verdict.kind).toBe("no-signal");
      expect(verdict.leaderId).toBeNull();
    });
  });

  describe("given a tie set the run partly separated", () => {
    it("excludes a variant the run distinguished from another tied member", () => {
      // L overlaps M and overlaps C, but M and C do NOT overlap (48 > 45).
      // Filtering against the leader alone swept all three into one set and
      // called them interchangeable — while the trust panel, counting pairs,
      // reported that same M/C pair as separated.
      const leaderboard = board([
        entry("L", 55, [40, 70]),
        entry("M", 52, [48, 110]),
        entry("C", 20, [-10, 45]),
      ]);

      const verdict = computeLeaderboardVerdict(leaderboard);

      expect(verdict.tiedIds).not.toContain("C");
      expect(verdict.tiedIds).toEqual(["L", "M"]);
    });

    it("agrees with the pair count the trust panel reports", () => {
      // The two used to contradict each other on screen.
      const leaderboard = board([
        entry("L", 55, [40, 70]),
        entry("M", 52, [48, 110]),
        entry("C", 20, [-10, 45]),
      ]);

      const verdict = computeLeaderboardVerdict(leaderboard);
      const adequacy = computeSampleAdequacy(leaderboard);

      // One pair separated (M vs C) => the tie set cannot hold all three.
      expect(adequacy.separatedPairs).toBe(1);
      expect(verdict.tiedIds).toHaveLength(2);
    });
  });

  describe("given a non-finite confidence bound", () => {
    it("does not read NaN as a separation", () => {
      // Every comparison against NaN is false, so the overlap test returned
      // false and its negation read "distinguishable" — yielding a confident
      // clear-winner beside an adequacy panel reporting zero separated pairs.
      const leaderboard = board([
        entry("a", 100, [NaN, NaN]),
        entry("b", 10, [5, 15]),
      ]);

      expect(computeLeaderboardVerdict(leaderboard).kind).toBe("tie-at-top");
    });

    it("does not read an infinite bound as a separation", () => {
      const leaderboard = board([
        entry("a", 100, [50, Infinity]),
        entry("b", 10, [-40, 40]),
      ]);

      expect(computeLeaderboardVerdict(leaderboard).kind).toBe("tie-at-top");
    });
  });

  describe("given a genuinely separated field", () => {
    it("still reports a clear winner", () => {
      // The guard above must not swallow real results.
      const leaderboard = board([
        entry("a", 200, [150, 250]),
        entry("b", 10, [-40, 40]),
      ]);

      const verdict = computeLeaderboardVerdict(leaderboard);
      expect(verdict.kind).toBe("clear-winner");
      expect(verdict.leaderId).toBe("a");
    });
  });
});

describe("computeBTLeaderboard — evidence it must not invent", () => {
  describe("given a winner that was not among the row's candidates", () => {
    it("ignores the row instead of crediting wins never played", () => {
      // variantIds is assembled from every label the column produced, while
      // `candidates` is the per-row set the judge saw. A winner dropped from
      // this row still resolved against the global index and beat opponents
      // it never faced: ten such rows minted twenty matchups and first place.
      const leaderboard = computeBTLeaderboard({
        comparisons: Array.from({ length: 10 }, () => ({
          candidates: ["a", "b"],
          winner: "c",
        })),
        variantIds: ["a", "b", "c"],
        bootstrapSamples: 0,
      });

      const c = leaderboard.entries.find((e) => e.variantId === "c")!;
      expect(c.wins).toBe(0);
      expect(c.matchups).toBe(0);
    });

    it("applies the same guard on the bootstrap path", () => {
      // The two matrix builders must agree, or the interval would describe a
      // different dataset than the point estimate it is drawn around.
      const leaderboard = computeBTLeaderboard({
        comparisons: [
          ...wins("a", "b", 6),
          ...wins("b", "a", 4),
          ...Array.from({ length: 10 }, () => ({
            candidates: ["a", "b"],
            winner: "c",
          })),
        ],
        variantIds: ["a", "b", "c"],
        bootstrapSamples: 50,
      });

      const c = leaderboard.entries.find((e) => e.variantId === "c")!;
      expect(c.matchups).toBe(0);
      expect(c.degenerate).toBe(true);
    });
  });
});
