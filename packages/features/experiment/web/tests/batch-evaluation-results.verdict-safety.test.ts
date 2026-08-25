import { describe, expect, it } from "vitest";

import { computeBTLeaderboard } from "@langwatch/experiment-web";
import {
  computeLeaderboardVerdict,
  findCheaperTiedAlternative,
} from "@langwatch/experiment-web";
import { computeSampleAdequacy } from "@langwatch/experiment-web";
import type {
  BTLeaderboard,
  BTLeaderboardEntry,
  VariantMetrics,
} from "@langwatch/experiment-web";

const metricStats = (avg: number, count: number) => ({
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
});

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

describe("computeLeaderboardVerdict — claims it must not make", () => {
  describe("given a strict order where the leader swept and the tail was swept", () => {
    /** @scenario "The last variant standing is not crowned by default" */
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

      expect(leaderboard.entries.filter((e) => !e.isDegenerate)).toHaveLength(1);

      const verdict = computeLeaderboardVerdict(leaderboard);

      expect(verdict.kind).toBe("no-signal");
      expect(verdict.leaderId).toBeNull();
    });
  });

  describe("given a tie set the run partly separated", () => {
    /** @scenario "Variants the run separated are never called interchangeable" */
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
      const leaderboard = board([entry("a", 100, [NaN, NaN]), entry("b", 10, [5, 15])]);

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
      const leaderboard = board([entry("a", 200, [150, 250]), entry("b", 10, [-40, 40])]);

      const verdict = computeLeaderboardVerdict(leaderboard);
      expect(verdict.kind).toBe("clear-winner");
      expect(verdict.leaderId).toBe("a");
    });
  });
});

describe("the verdict on a field that broke into groups that never met", () => {
  /**
   * Two islands: {a,b} traded wins closely, {c,d} did not, and no row ever
   * put an islander against the other island. The whole fixture goes through
   * the real fit — no hand-built leaderboard — because the failure was
   * invisible at that level: the between-island gap is a pure artifact of
   * `normalizeToGeometricMean`, every bootstrap replicate re-applies the same
   * normalisation, so the DIFFERENCE interval comes out tight and the
   * interval test read it as a confident separation.
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

  it("sees the break at all — the fixture is the shape under test", () => {
    const leaderboard = twoIslands();

    expect(leaderboard.comparability.identifiable).toBe(false);
    expect(leaderboard.comparability.groups).toHaveLength(2);
    // Every variant won and lost, so the solver's own degeneracy guard —
    // the check this one exists to backstop — reports the field healthy.
    expect(leaderboard.entries.every((e) => !e.isDegenerate)).toBe(true);
  });

  /** @scenario "A winner is never named across variants that never met" */
  it("does not name a variant to ship", () => {
    const verdict = computeLeaderboardVerdict(twoIslands());

    expect(verdict.kind).toBe("not-comparable");
    // Asserted on the kind rather than the sentence: the headline is prose
    // and will be reworded, but "this run picked a winner" must never again
    // be derivable from a fit that never compared them.
    expect(verdict.kind).not.toBe("clear-winner");
  });

  it("does not offer the cheaper of two variants that never met", () => {
    const verdict = computeLeaderboardVerdict(twoIslands());

    // `not-comparable` is what suppresses this: a cost-based swap is only
    // honest between variants the run established are equal on quality.
    expect(
      findCheaperTiedAlternative({
        verdict,
        variantMetrics: Object.fromEntries(
          ["a", "b", "c", "d"].map((id) => [
            id,
            {
              variantId: id,
              costStats: metricStats(id === "a" ? 0.001 : 0.02, 50),
              durationStats: null,
              costMeanCI: null,
              durationMeanCI: null,
              costDifferenceCI: {},
              durationDifferenceCI: {},
            } satisfies VariantMetrics,
          ]),
        ),
      }),
    ).toBeNull();
  });

  /** @scenario "Pairs that never met are not counted as pairs the run settled" */
  it("does not count the cross-group pairs as pairs it separated", () => {
    const adequacy = computeSampleAdequacy(twoIslands());

    // Six pairs across four variants; the four spanning the break carry no
    // evidence, so at most the two within-island pairs can be separated.
    expect(adequacy.totalPairs).toBe(6);
    expect(adequacy.separatedPairs).toBeLessThanOrEqual(2);
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

    it("counts a repeated candidate id once, not twice", () => {
      // `targetIdByAnyKey` maps several keys onto one target, so a row can
      // name the same variant twice. Undeduplicated, one verdict credited a
      // two-nil record and the interval tightened around evidence produced
      // only once.
      const leaderboard = computeBTLeaderboard({
        comparisons: [{ candidates: ["a", "b", "b"], winner: "a" }],
        variantIds: ["a", "b"],
        bootstrapSamples: 0,
      });

      expect(leaderboard.winMatrix.a?.b).toBe(1);
      expect(leaderboard.entries.find((e) => e.variantId === "a")?.matchups).toBe(1);
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
      expect(c.isDegenerate).toBe(true);
    });
  });
});

describe("findCheaperTiedAlternative — the saving it quotes", () => {
  const tie = (ids: string[]) => ({
    kind: "tie-at-top" as const,
    leaderId: ids[0]!,
    tiedIds: ids,
  });

  const metrics = (
    costs: Record<string, [number, number] | null>,
  ): Record<string, VariantMetrics> =>
    Object.fromEntries(
      Object.entries(costs).map(([id, v]) => [
        id,
        {
          variantId: id,
          costStats: v === null ? null : metricStats(v[0], v[1]),
          durationStats: null,
          costMeanCI: null,
          durationMeanCI: null,
          costDifferenceCI: {},
          durationDifferenceCI: {},
        },
      ]),
    );

  describe("given the leader is not the dearest tied variant", () => {
    /** @scenario "A cheaper recommendation is measured against what I would ship" */
    it("measures the saving against the leader, not the dearest", () => {
      // Leader $0.002, another tied option $0.010, cheapest $0.0018.
      // Against the dearest that is an 82% saving; but the reader ships the
      // leader by default, and switching from it saves 10%.
      const result = findCheaperTiedAlternative({
        verdict: tie(["L", "M", "C"]),
        variantMetrics: metrics({
          L: [0.002, 20],
          M: [0.01, 20],
          C: [0.0018, 20],
        }),
        minSaving: 0.05,
      });

      expect(result?.variantId).toBe("C");
      expect(result?.dearestCost).toBe(0.002);
      expect(result?.savingRatio).toBeCloseTo(0.1, 5);
    });
  });

  describe("given the leader is itself the cheapest", () => {
    it("compares against the dearest tied option, since there is no switch", () => {
      const result = findCheaperTiedAlternative({
        verdict: tie(["L", "M"]),
        variantMetrics: metrics({ L: [0.002, 20], M: [0.01, 20] }),
      });

      expect(result?.isLeader).toBe(true);
      expect(result?.dearestCost).toBe(0.01);
      expect(result?.savingRatio).toBeCloseTo(0.8, 5);
    });
  });

  describe("given a mean drawn from too few priced rows", () => {
    /** @scenario "A cost averaged over too few rows does not drive the headline" */
    it("declines to recommend on cost", () => {
      // Rows are priced independently, so a run can record cost on one row
      // and leave the rest null. That average was previously printed as
      // "$X per row" and drove the headline.
      expect(
        findCheaperTiedAlternative({
          verdict: tie(["L", "C"]),
          variantMetrics: metrics({ L: [0.01, 1], C: [0.001, 1] }),
        }),
      ).toBeNull();
    });
  });
});

describe("findCheaperTiedAlternative — the saving must be one the run can see", () => {
  const tie2 = (ids: string[]) => ({
    kind: "tie-at-top" as const,
    leaderId: ids[0]!,
    tiedIds: ids,
  });

  const metricsWith = ({
    costs,
    differences,
  }: {
    costs: Record<string, [number, number]>;
    differences?: Record<string, Record<string, [number, number]>>;
  }): Record<string, VariantMetrics> =>
    Object.fromEntries(
      Object.entries(costs).map(([id, v]) => [
        id,
        {
          variantId: id,
          costStats: metricStats(v[0], v[1]),
          durationStats: null,
          costMeanCI: null,
          durationMeanCI: null,
          costDifferenceCI: differences?.[id] ?? {},
          durationDifferenceCI: {},
        },
      ]),
    );

  describe("given a large mean gap the paired test cannot separate", () => {
    it("declines to recommend the switch", () => {
      // Rows vary far more than the variants do, so the averages differ
      // sharply while the per-row difference straddles zero. Recommending a
      // switch here reads as a cost saving the run never established — the
      // same fault the dominance check was fixed for, in the headline.
      const result = findCheaperTiedAlternative({
        verdict: tie2(["L", "C"]),
        variantMetrics: metricsWith({
          costs: { L: [0.01, 40], C: [0.002, 40] },
          differences: {
            L: { C: [-0.004, 0.02] },
            C: { L: [-0.02, 0.004] },
          },
        }),
      });

      expect(result).toBeNull();
    });
  });

  describe("given the paired test does separate them", () => {
    it("still recommends the cheaper one", () => {
      const result = findCheaperTiedAlternative({
        verdict: tie2(["L", "C"]),
        variantMetrics: metricsWith({
          costs: { L: [0.01, 40], C: [0.002, 40] },
          differences: {
            L: { C: [0.006, 0.01] },
            C: { L: [-0.01, -0.006] },
          },
        }),
      });

      expect(result?.variantId).toBe("C");
    });
  });

  describe("given no paired intervals at all", () => {
    it("falls back to the mean gap rather than going silent", () => {
      const result = findCheaperTiedAlternative({
        verdict: tie2(["L", "C"]),
        variantMetrics: metricsWith({
          costs: { L: [0.01, 40], C: [0.002, 40] },
        }),
      });

      expect(result?.variantId).toBe("C");
    });
  });
});
