import { describe, expect, it } from "vitest";

import { computeBTLeaderboard } from "@langwatch/experiment-web";
import { computeParetoDominance } from "@langwatch/experiment-web";
import type { BTLeaderboard, BTLeaderboardEntry, VariantMetrics } from "@langwatch/experiment-web";

/**
 * Dominance is the one claim on the trade-off chart a reader acts on
 * directly — "this variant is beaten outright, drop it". It is therefore
 * held to the same standard as the verdict: never asserted from a
 * difference the run cannot actually see.
 *
 * @see specs/experiments/comparison-leaderboard.feature
 */

const stats = (avg: number, count = 20) =>
  ({
    min: avg,
    max: avg,
    avg,
    median: avg,
    p75: avg,
    p90: avg,
    p95: avg,
    p99: avg,
    total: avg * count,
    count,
  }) as const;

const entry = ({
  variantId,
  score,
  scoreCI,
  isDegenerate = false,
}: {
  variantId: string;
  score: number;
  scoreCI: [number, number] | null;
  isDegenerate?: boolean;
}): BTLeaderboardEntry => ({
  variantId,
  wins: 5,
  losses: 5,
  matchups: 10,
  winRate: 0.5,
  strength: 1,
  score,
  scoreCI,
  isDegenerate,
});

const board = (entries: BTLeaderboardEntry[]): BTLeaderboard => ({
  entries,
  winMatrix: {},
  comparisonCount: 60,
  minMatchups: 60,
  hasDegenerate: entries.some((e) => e.isDegenerate),
  didConverge: true,
  comparability: { identifiable: true, groups: [], dominates: [] },
  scoreDifferenceCI: null,
  bootstrapNonConvergence: null,
});

/**
 * Paired difference interval standing in for what the bootstrap would produce
 * from well-behaved rows: a clear gap yields an interval on one side of zero,
 * a negligible one yields an interval spanning it.
 *
 * The helper used to omit these entirely, which quietly pointed every test in
 * this file at the mean-comparison fallback — a branch production cannot
 * reach, since `computeVariantMetrics` is the only builder of VariantMetrics
 * and always populates the maps. Ten tests were passing against dead code.
 */
const SYNTHETIC_GAP = 0.1;

const differenceInterval = (
  mine: number | null | undefined,
  theirs: number | null | undefined,
): [number, number] | null => {
  if (mine === null || mine === void 0 || theirs === null || theirs === void 0) {
    return null;
  }
  const diff = mine - theirs;
  const larger = Math.max(Math.abs(mine), Math.abs(theirs));
  if (larger === 0 || Math.abs(diff) / larger < SYNTHETIC_GAP) {
    // Too close to call: an interval straddling zero.
    const halfWidth = Math.abs(diff) + larger * SYNTHETIC_GAP;
    return [diff - halfWidth, diff + halfWidth];
  }
  // A real gap: a tight interval that stays on the sign of the difference.
  const halfWidth = Math.abs(diff) * 0.2;
  return [diff - halfWidth, diff + halfWidth];
};

/** One variant's interval against each opponent, keyed by opponent id. */
const pairIntervals = (
  mine: number | null | undefined,
  others: Array<[string, number | null | undefined]>,
): Record<string, [number, number]> => {
  const out: Record<string, [number, number]> = {};
  for (const [id, theirs] of others) {
    const ci = differenceInterval(mine, theirs);
    if (ci) out[id] = ci;
  }
  return out;
};

const statsOrNull = (value: number | null | undefined, rows: number) =>
  value === null || value === void 0 ? null : stats(value, rows);

const metrics = (
  byId: Record<string, { cost?: number | null; duration?: number | null; rows?: number }>,
): Record<string, VariantMetrics> => {
  const ids = Object.keys(byId);
  return Object.fromEntries(
    ids.map((variantId) => {
      const m = byId[variantId]!;
      const rows = m.rows ?? 20;
      const others = ids.filter((id) => id !== variantId);
      return [
        variantId,
        {
          variantId,
          costStats: statsOrNull(m.cost, rows),
          durationStats: statsOrNull(m.duration, rows),
          costMeanCI: null,
          durationMeanCI: null,
          costDifferenceCI: pairIntervals(
            m.cost,
            others.map((id) => [id, byId[id]!.cost]),
          ),
          durationDifferenceCI: pairIntervals(
            m.duration,
            others.map((id) => [id, byId[id]!.duration]),
          ),
        },
      ];
    }),
  );
};

describe("computeParetoDominance", () => {
  describe("given a variant beaten on quality, cost and speed", () => {
    const leaderboard = board([
      entry({ variantId: "a", score: 200, scoreCI: [150, 250] }),
      entry({ variantId: "b", score: 10, scoreCI: [-40, 40] }),
    ]);
    const variantMetrics = metrics({
      a: { cost: 0.001, duration: 1000 },
      b: { cost: 0.01, duration: 5000 },
    });

    /** @scenario "A variant beaten on every metric is named outright" */
    it("names the variant that beats it", () => {
      const dominance = computeParetoDominance({ leaderboard, variantMetrics });

      expect(dominance.dominatedBy.b).toEqual(["a"]);
      expect(dominance.dominatedBy.a).toEqual([]);
    });

    it("lists every dimension the winner actually won on", () => {
      const dominance = computeParetoDominance({ leaderboard, variantMetrics });
      const edge = dominance.edges.find((e) => e.loserId === "b")!;

      expect(edge.winnerId).toBe("a");
      expect(edge.strictlyBetterOn).toEqual(["quality", "cost", "speed"]);
    });

    it("leaves only the winner on the front", () => {
      expect(computeParetoDominance({ leaderboard, variantMetrics }).front).toEqual(["a"]);
    });
  });

  describe("given overlapping confidence intervals but a real cost and speed gap", () => {
    // The quality difference is invisible to this run. Dominance still
    // holds — a tie is "not worse" — but it must not be reported as a
    // quality win, which is the claim a reader would act on hardest.
    const leaderboard = board([
      entry({ variantId: "a", score: 60, scoreCI: [20, 100] }),
      entry({ variantId: "b", score: 50, scoreCI: [10, 90] }),
    ]);
    const variantMetrics = metrics({
      a: { cost: 0.001, duration: 1000 },
      b: { cost: 0.01, duration: 5000 },
    });

    it("still reports the variant as beaten outright", () => {
      expect(computeParetoDominance({ leaderboard, variantMetrics }).dominatedBy.b).toEqual(["a"]);
    });

    /** @scenario "Dominance is never claimed from a quality difference the run cannot see" */
    it("does not count quality among the dimensions won", () => {
      const edge = computeParetoDominance({
        leaderboard,
        variantMetrics,
      }).edges.find((e) => e.loserId === "b")!;

      expect(edge.strictlyBetterOn).toEqual(["cost", "speed"]);
      expect(edge.strictlyBetterOn).not.toContain("quality");
    });
  });

  describe("given a higher score the run cannot separate and no other advantage", () => {
    it("claims no dominance at all", () => {
      // Every dimension ties, so nothing is strictly better and there is
      // nothing to drop. Reporting dominance here would be reading noise.
      const leaderboard = board([
        entry({ variantId: "a", score: 60, scoreCI: [20, 100] }),
        entry({ variantId: "b", score: 50, scoreCI: [10, 90] }),
      ]);
      const variantMetrics = metrics({
        a: { cost: 0.001, duration: 1000 },
        b: { cost: 0.001, duration: 1000 },
      });

      const dominance = computeParetoDominance({ leaderboard, variantMetrics });

      expect(dominance.edges).toEqual([]);
      expect(dominance.front).toEqual(["a", "b"]);
    });
  });

  describe("given a cost difference the paired interval cannot resolve", () => {
    // 2% apart, which the helper renders as an interval straddling zero —
    // the shape a real bootstrap produces when the gap is lost in the
    // row-to-row spread.
    const TWO_PERCENT_APART = 1.02;

    /** @scenario "A negligible cost or speed difference is not a win" */
    it("does not treat it as cheaper", () => {
      // No duration on purpose: an equal duration on both sides is itself
      // decided by the floor, so leaving it in lets the speed comparison
      // mask what this test is trying to observe about cost.
      const leaderboard = board([
        entry({ variantId: "a", score: 60, scoreCI: [20, 100] }),
        entry({ variantId: "b", score: 50, scoreCI: [10, 90] }),
      ]);
      const variantMetrics = metrics({
        a: { cost: 0.001 },
        b: { cost: 0.001 * TWO_PERCENT_APART },
      });

      expect(computeParetoDominance({ leaderboard, variantMetrics }).edges).toEqual([]);
    });
  });

  describe("given a genuine trade-off", () => {
    /** @scenario "A variant nothing beats outright is left for the reader to choose between" */
    it("reports no variant to drop", () => {
      // a is better but dearer. That is the case the chart exists for, and
      // the reader has to make the call.
      const leaderboard = board([
        entry({ variantId: "a", score: 200, scoreCI: [150, 250] }),
        entry({ variantId: "b", score: 10, scoreCI: [-40, 40] }),
      ]);
      const variantMetrics = metrics({
        a: { cost: 0.01, duration: 5000 },
        b: { cost: 0.001, duration: 1000 },
      });

      const dominance = computeParetoDominance({ leaderboard, variantMetrics });

      expect(dominance.edges).toEqual([]);
      expect(dominance.front).toEqual(["a", "b"]);
    });
  });

  describe("given no duration recorded anywhere", () => {
    /** @scenario "Dominance is only claimed over metrics the run actually recorded" */
    it("compares on quality and cost only", () => {
      const leaderboard = board([
        entry({ variantId: "a", score: 200, scoreCI: [150, 250] }),
        entry({ variantId: "b", score: 10, scoreCI: [-40, 40] }),
      ]);
      const variantMetrics = metrics({
        a: { cost: 0.001, duration: null },
        b: { cost: 0.01, duration: null },
      });

      const dominance = computeParetoDominance({ leaderboard, variantMetrics });

      expect(dominance.dimensions).toEqual(["quality", "cost"]);
      expect(dominance.edges.find((e) => e.loserId === "b")!.strictlyBetterOn).toEqual([
        "quality",
        "cost",
      ]);
    });
  });

  describe("given a cost mean drawn from too few priced rows", () => {
    it("does not compare on cost", () => {
      // Same floor the cost recommendation uses. A mean over one row is
      // not a cost, and dominance is a stronger claim than a suggestion.
      const leaderboard = board([
        entry({ variantId: "a", score: 200, scoreCI: [150, 250] }),
        entry({ variantId: "b", score: 10, scoreCI: [-40, 40] }),
      ]);
      const variantMetrics = metrics({
        a: { cost: 0.001, duration: 1000, rows: 1 },
        b: { cost: 0.01, duration: 1000, rows: 1 },
      });

      const dominance = computeParetoDominance({ leaderboard, variantMetrics });

      expect(dominance.dimensions).not.toContain("cost");
      expect(dominance.edges.find((e) => e.loserId === "b")!.strictlyBetterOn).toEqual(["quality"]);
    });
  });

  describe("given a missing confidence interval", () => {
    it("treats quality as unreadable rather than as a win", () => {
      // Absence of an interval is absence of evidence. Without this the
      // raw score ordering would silently become the quality verdict.
      const leaderboard = board([
        entry({ variantId: "a", score: 200, scoreCI: null }),
        entry({ variantId: "b", score: 10, scoreCI: null }),
      ]);
      const variantMetrics = metrics({
        a: { cost: 0.001, duration: 1000 },
        b: { cost: 0.001, duration: 1000 },
      });

      expect(computeParetoDominance({ leaderboard, variantMetrics }).edges).toEqual([]);
    });
  });

  describe("given a degenerate variant", () => {
    it("leaves it out of the comparison entirely", () => {
      // It has no meaningful score, so it can neither dominate nor be
      // dominated without the claim resting on a number that means nothing.
      const leaderboard = board([
        entry({ variantId: "a", score: 200, scoreCI: [150, 250] }),
        entry({ variantId: "b", score: 10, scoreCI: [-40, 40] }),
        entry({
          variantId: "swept",
          score: 900,
          scoreCI: null,
          isDegenerate: true,
        }),
      ]);
      const variantMetrics = metrics({
        a: { cost: 0.001, duration: 1000 },
        b: { cost: 0.01, duration: 5000 },
        swept: { cost: 0.0001, duration: 100 },
      });

      const dominance = computeParetoDominance({ leaderboard, variantMetrics });

      expect(dominance.front).not.toContain("swept");
      expect(dominance.edges.some((e) => e.winnerId === "swept")).toBe(false);
      expect(dominance.edges.some((e) => e.loserId === "swept")).toBe(false);
    });
  });

  describe("given three variants where one is beaten by two others", () => {
    it("names every variant that beats it", () => {
      const leaderboard = board([
        entry({ variantId: "a", score: 200, scoreCI: [150, 250] }),
        entry({ variantId: "b", score: 100, scoreCI: [60, 140] }),
        entry({ variantId: "c", score: 10, scoreCI: [-40, 40] }),
      ]);
      const variantMetrics = metrics({
        a: { cost: 0.001, duration: 1000 },
        b: { cost: 0.002, duration: 2000 },
        c: { cost: 0.01, duration: 5000 },
      });

      const dominance = computeParetoDominance({ leaderboard, variantMetrics });

      expect(dominance.dominatedBy.c).toEqual(["a", "b"]);
      expect(dominance.front).toEqual(["a"]);
    });
  });

  describe("given no metrics at all", () => {
    it("still compares on quality alone", () => {
      const leaderboard = board([
        entry({ variantId: "a", score: 200, scoreCI: [150, 250] }),
        entry({ variantId: "b", score: 10, scoreCI: [-40, 40] }),
      ]);

      const dominance = computeParetoDominance({
        leaderboard,
        variantMetrics: {},
      });

      expect(dominance.dimensions).toEqual(["quality"]);
      expect(dominance.dominatedBy.b).toEqual(["a"]);
    });
  });
});

describe("computeParetoDominance — when the paired test declined", () => {
  const board2 = (entries: BTLeaderboardEntry[]): BTLeaderboard => ({
    entries,
    winMatrix: {},
    comparisonCount: 60,
    minMatchups: 60,
    hasDegenerate: false,
    didConverge: true,
    comparability: { identifiable: true, groups: [], dominates: [] },
    scoreDifferenceCI: null,
    bootstrapNonConvergence: null,
  });

  describe("given the run computed intervals but not for this pair", () => {
    /** @scenario "Cheaper and faster are decided per row, not on the averages" */
    it("treats cost as unknown rather than falling back to the averages", () => {
      // The interval is absent precisely because the two shared too few rows.
      // Falling back to a threshold on the averages judges anyway, using a
      // cruder test, in the one case where the averages are least
      // trustworthy — and re-asserts the claim the paired test just refused.
      const leaderboard = board2([
        entry({ variantId: "a", score: 200, scoreCI: [150, 250] }),
        entry({ variantId: "b", score: 10, scoreCI: [-40, 40] }),
      ]);
      const variantMetrics = {
        a: {
          variantId: "a",
          costStats: stats(0.001, 20),
          durationStats: null,
          costMeanCI: null,
          durationMeanCI: null,
          // Present but empty: the pipeline ran and produced nothing here.
          costDifferenceCI: {},
          durationDifferenceCI: {},
        },
        b: {
          variantId: "b",
          costStats: stats(0.01, 20),
          durationStats: null,
          costMeanCI: null,
          durationMeanCI: null,
          costDifferenceCI: {},
          durationDifferenceCI: {},
        },
      } satisfies Record<string, VariantMetrics>;

      const dominance = computeParetoDominance({ leaderboard, variantMetrics });
      const edge = dominance.edges.find((e) => e.loserId === "b");

      // a still wins on quality, but cost must not be claimed.
      expect(edge?.strictlyBetterOn).toEqual(["quality"]);
      expect(edge?.strictlyBetterOn).not.toContain("cost");
    });
  });
});

describe("computeParetoDominance — the duration side of the paired test", () => {
  const board3 = (entries: BTLeaderboardEntry[]): BTLeaderboard => ({
    entries,
    winMatrix: {},
    comparisonCount: 60,
    minMatchups: 60,
    hasDegenerate: false,
    didConverge: true,
    comparability: { identifiable: true, groups: [], dominates: [] },
    scoreDifferenceCI: { a: { b: [40, 160] }, b: { a: [-160, -40] } },
    bootstrapNonConvergence: null,
  });

  const withDurations = ({
    durationDiff,
  }: {
    durationDiff: [number, number];
  }): Record<string, VariantMetrics> => ({
    a: {
      variantId: "a",
      costStats: stats(0.00171, 60),
      durationStats: stats(17576, 60),
      costMeanCI: null,
      durationMeanCI: null,
      costDifferenceCI: { b: [-0.0009, -0.0002] },
      durationDifferenceCI: { b: durationDiff },
    },
    b: {
      variantId: "b",
      costStats: stats(0.00226, 60),
      durationStats: stats(22654, 60),
      costMeanCI: null,
      durationMeanCI: null,
      costDifferenceCI: { a: [0.0002, 0.0009] },
      durationDifferenceCI: {
        a: [-durationDiff[1], -durationDiff[0]],
      },
    },
  });

  describe("given a mean speed gap swamped by row-to-row variation", () => {
    /** @scenario "A speed difference swamped by row-to-row variation is not claimed" */
    it("does not claim the faster average as a speed win", () => {
      // Taken from the live run: 'a' averages 8.2s faster than 'b' over 60
      // paired rows, but the per-row difference has a standard deviation of
      // 52s, so the interval runs from -21.4s to +5.0s and includes zero.
      // The averages alone would have called this a 22% speed advantage.
      const leaderboard = board3([
        entry({ variantId: "a", score: 153, scoreCI: [72, 235] }),
        entry({ variantId: "b", score: 45, scoreCI: [-30, 120] }),
      ]);

      const dominance = computeParetoDominance({
        leaderboard,
        variantMetrics: withDurations({ durationDiff: [-21379, 5020] }),
      });
      const edge = dominance.edges.find((e) => e.loserId === "b")!;

      expect(edge.strictlyBetterOn).toEqual(["quality", "cost"]);
      expect(edge.strictlyBetterOn).not.toContain("speed");
    });
  });

  describe("given a speed gap the run can actually see", () => {
    it("counts it, so the guard above is not simply refusing everything", () => {
      const leaderboard = board3([
        entry({ variantId: "a", score: 153, scoreCI: [72, 235] }),
        entry({ variantId: "b", score: 45, scoreCI: [-30, 120] }),
      ]);

      const dominance = computeParetoDominance({
        leaderboard,
        variantMetrics: withDurations({ durationDiff: [-9000, -3000] }),
      });
      const edge = dominance.edges.find((e) => e.loserId === "b")!;

      expect(edge.strictlyBetterOn).toEqual(["quality", "cost", "speed"]);
    });
  });
});

describe("computeParetoDominance — a field that broke into groups that never met", () => {
  const wins = (winner: string, loser: string, times: number) =>
    Array.from({ length: times }, () => ({
      candidates: [winner, loser],
      winner,
    }));

  /**
   * The real fit rather than a hand-built board, because the break is not
   * visible at that level: every variant won and lost, so the solver's own
   * degeneracy guard reports the field healthy, and the between-group gap
   * arrives looking like an ordinary score difference.
   */
  const twoIslands = () =>
    computeBTLeaderboard({
      comparisons: [
        ...wins("a", "b", 26),
        ...wins("b", "a", 24),
        ...wins("c", "d", 48),
        ...wins("d", "c", 2),
      ],
      variantIds: ["a", "b", "c", "d"],
      bootstrapSamples: 200,
    });

  const ISLAND: Record<string, number> = { a: 0, b: 0, c: 1, d: 1 };

  /** @scenario "A variant is never called droppable by one it never met" */
  it("claims no dominance across the break", () => {
    const leaderboard = twoIslands();
    expect(leaderboard.comparability.identifiable).toBe(false);

    const dominance = computeParetoDominance({
      leaderboard,
      // Identical costs, so every cost interval straddles zero and quality is
      // the only dimension left that can carry an edge.
      variantMetrics: metrics({
        a: { cost: 0.01 },
        b: { cost: 0.01 },
        c: { cost: 0.01 },
        d: { cost: 0.01 },
      }),
    });

    expect(
      dominance.edges.filter((edge) => ISLAND[edge.winnerId] !== ISLAND[edge.loserId]),
    ).toEqual([]);
  });
});
