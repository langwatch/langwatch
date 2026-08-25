import { describe, expect, it } from "vitest";

import { computeBTLeaderboard } from "../computeBTLeaderboard";
import { comparabilityOf, computeComparability } from "../computeComparability";

/**
 * @see specs/experiments/comparison-leaderboard.feature
 *   "A ranking the run cannot justify is refused, not rounded off"
 *
 * These pin the two shapes that defeated the old per-variant guard. Both were
 * found by auditing the solver against Ford (1957): the previous check asked
 * whether any single variant had zero wins or zero losses, which is necessary
 * for the MLE to exist but not sufficient.
 */

const wins = (winner: string, loser: string, times: number) =>
  Array.from({ length: times }, () => ({
    candidates: [winner, loser],
    winner,
  }));

describe("computeComparability", () => {
  describe("given a field where everyone eventually beats everyone", () => {
    it("reports one group and calls the fit identifiable", () => {
      const leaderboard = computeBTLeaderboard({
        comparisons: [
          ...wins("A", "B", 6),
          ...wins("B", "A", 3),
          ...wins("B", "C", 6),
          ...wins("C", "B", 3),
          ...wins("C", "A", 4),
          ...wins("A", "C", 5),
        ],
        variantIds: ["A", "B", "C"],
        bootstrapSamples: 0,
      });

      const comparability = computeComparability({
        winMatrix: leaderboard.winMatrix,
        variantIds: ["A", "B", "C"],
      });

      expect(comparability.identifiable).toBe(true);
      expect(comparability.groups).toHaveLength(1);
    });
  });

  describe("given a tiered field where the good tier never loses to the bad one", () => {
    // The shape that made the solver report a maxIter artifact as a score.
    // Every variant has wins AND losses, so the old guard saw nothing wrong.
    const comparisons = [
      ...wins("A", "B", 4),
      ...wins("B", "A", 3),
      ...wins("C", "D", 3),
      ...wins("D", "C", 2),
      ...wins("A", "C", 5),
      ...wins("A", "D", 5),
      ...wins("B", "C", 5),
      ...wins("B", "D", 5),
    ];
    const variantIds = ["A", "B", "C", "D"];

    /** @scenario "A field that splits into tiers is not presented as one scale" */
    it("is not identifiable even though no variant swept or was swept", () => {
      const leaderboard = computeBTLeaderboard({
        comparisons,
        variantIds,
        bootstrapSamples: 0,
      });

      // The premise: the old guard is clean here. If this ever fails, the
      // test is no longer covering the gap it was written for.
      expect(leaderboard.hasDegenerate).toBe(false);
      expect(leaderboard.entries.every((e) => !e.isDegenerate)).toBe(true);

      const comparability = computeComparability({
        winMatrix: leaderboard.winMatrix,
        variantIds,
      });

      expect(comparability.identifiable).toBe(false);
      expect(comparability.groups).toHaveLength(2);
    });

    it("puts the dominant tier first and records the direction", () => {
      const leaderboard = computeBTLeaderboard({
        comparisons,
        variantIds,
        bootstrapSamples: 0,
      });
      const comparability = computeComparability({
        winMatrix: leaderboard.winMatrix,
        variantIds,
      });

      expect([...comparability.groups[0]!].sort()).toEqual(["A", "B"]);
      expect([...comparability.groups[1]!].sort()).toEqual(["C", "D"]);
      expect(comparability.dominates[0]![1]).toBe(true);
      expect(comparability.dominates[1]![0]).toBe(false);
    });

    it("calls a cross-tier pair dominated, not comparable on score", () => {
      const comparability = computeComparability({
        winMatrix: computeBTLeaderboard({
          comparisons,
          variantIds,
          bootstrapSamples: 0,
        }).winMatrix,
        variantIds,
      });

      // Direction is certain; the gap is not a measurement.
      expect(comparabilityOf({ comparability, a: "A", b: "C" })).toBe("dominated");
      expect(comparabilityOf({ comparability, a: "A", b: "B" })).toBe("same-group");
    });
  });

  describe("given two groups that never met", () => {
    // Reachable in the ordinary way: the evaluator drops a candidate that
    // produced no output for a row.
    const comparisons = [
      ...wins("A", "B", 9),
      ...wins("B", "A", 1),
      ...wins("C", "D", 5),
      ...wins("D", "C", 5),
    ];
    const variantIds = ["A", "B", "C", "D"];

    /** @scenario "A ranking that cannot settle does not claim it has" */
    it("is not identifiable", () => {
      const comparability = computeComparability({
        winMatrix: computeBTLeaderboard({
          comparisons,
          variantIds,
          bootstrapSamples: 0,
        }).winMatrix,
        variantIds,
      });

      expect(comparability.identifiable).toBe(false);
    });

    /** @scenario "Variants that never met are not ordered against each other" */
    it("refuses to order variants from different islands", () => {
      const comparability = computeComparability({
        winMatrix: computeBTLeaderboard({
          comparisons,
          variantIds,
          bootstrapSamples: 0,
        }).winMatrix,
        variantIds,
      });

      // A and C never met and share no opponent. The solver still hands back
      // numbers for both; nothing may be concluded from their order.
      expect(comparabilityOf({ comparability, a: "A", b: "C" })).toBe("incomparable");
    });
  });

  describe("given a tie between two otherwise separate groups", () => {
    it("treats the tie as the connecting evidence it is", () => {
      // A tie puts 0.5 in both directions, which is what makes an otherwise
      // split field identifiable. Dropping ties from the graph would report
      // a false split here.
      const comparability = computeComparability({
        winMatrix: computeBTLeaderboard({
          comparisons: [
            ...wins("A", "B", 3),
            ...wins("B", "A", 3),
            ...wins("C", "D", 3),
            ...wins("D", "C", 3),
            { candidates: ["B", "C"], winner: "tie" },
          ],
          variantIds: ["A", "B", "C", "D"],
          bootstrapSamples: 0,
        }).winMatrix,
        variantIds: ["A", "B", "C", "D"],
      });

      expect(comparability.identifiable).toBe(true);
    });
  });

  describe("given trivial input", () => {
    it("handles an empty field", () => {
      expect(computeComparability({ winMatrix: {}, variantIds: [] })).toEqual({
        identifiable: true,
        groups: [],
        dominates: [],
      });
    });

    it("calls a single variant identifiable", () => {
      const comparability = computeComparability({
        winMatrix: { A: {} },
        variantIds: ["A"],
      });
      expect(comparability.identifiable).toBe(true);
      expect(comparability.groups).toEqual([["A"]]);
    });
  });
});
