import { describe, expect, it } from "vitest";

import { computeBTLeaderboard } from "@langwatch/experiment-web";
import { winMatrixHasPairwiseDetail } from "@langwatch/experiment-web";

/**
 * @see specs/experiments/comparison-leaderboard.feature
 *   "A matrix with no pairwise information says so"
 */

describe("winMatrixHasPairwiseDetail", () => {
  describe("given every verdict judged the whole field", () => {
    /** @scenario "A matrix with no pairwise information says so" */
    it("reports no pairwise detail", () => {
      // The real shape: one four-way verdict per row, so a winner beats all
      // three others at once and its row is the same number repeated.
      const comparisons = [
        ...Array.from({ length: 7 }, () => ({
          candidates: ["A", "B", "C", "D"],
          winner: "A",
        })),
        ...Array.from({ length: 5 }, () => ({
          candidates: ["A", "B", "C", "D"],
          winner: "B",
        })),
        ...Array.from({ length: 2 }, () => ({
          candidates: ["A", "B", "C", "D"],
          winner: "C",
        })),
      ];

      const leaderboard = computeBTLeaderboard({
        comparisons,
        variantIds: ["A", "B", "C", "D"],
        bootstrapSamples: 0,
      });

      // Guard the premise: if this stops being uniform the test is no longer
      // exercising the case it names.
      expect(leaderboard.winMatrix.A).toMatchObject({ B: 7, C: 7, D: 7 });

      expect(
        winMatrixHasPairwiseDetail({
          winMatrix: leaderboard.winMatrix,
          variantIds: ["A", "B", "C", "D"],
        }),
      ).toBe(false);
    });
  });

  describe("given verdicts over differing subsets", () => {
    /** @scenario "A matrix built from differing candidate sets keeps its pairwise reading" */
    it("reports pairwise detail", () => {
      const comparisons = [
        // A dominates B but splits with C — a real head-to-head difference.
        ...Array.from({ length: 6 }, () => ({
          candidates: ["A", "B"],
          winner: "A",
        })),
        ...Array.from({ length: 2 }, () => ({
          candidates: ["A", "C"],
          winner: "A",
        })),
        ...Array.from({ length: 3 }, () => ({
          candidates: ["A", "C"],
          winner: "C",
        })),
      ];

      const leaderboard = computeBTLeaderboard({
        comparisons,
        variantIds: ["A", "B", "C"],
        bootstrapSamples: 0,
      });

      expect(
        winMatrixHasPairwiseDetail({
          winMatrix: leaderboard.winMatrix,
          variantIds: ["A", "B", "C"],
        }),
      ).toBe(true);
    });
  });

  describe("given a variant that never won", () => {
    it("does not let its empty row mask real detail elsewhere", () => {
      // D's row is all zeros. Counting that as "uniform" would be reading
      // absence of evidence as evidence, and would flatten a matrix that
      // genuinely varies on A's row.
      const winMatrix = {
        A: { B: 5, C: 1, D: 5 },
        B: { A: 1, C: 1, D: 1 },
        C: { A: 1, B: 1, D: 1 },
        D: { A: 0, B: 0, C: 0 },
      };

      expect(
        winMatrixHasPairwiseDetail({
          winMatrix,
          variantIds: ["A", "B", "C", "D"],
        }),
      ).toBe(true);
    });
  });

  describe("given only two variants", () => {
    it("reports no pairwise detail, since there is only one pair", () => {
      // With one opponent each there is nothing to vary against — the caveat
      // is meaningless rather than wrong, and the two-variant case does not
      // render a leaderboard at all.
      const winMatrix = { A: { B: 9 }, B: { A: 3 } };

      expect(winMatrixHasPairwiseDetail({ winMatrix, variantIds: ["A", "B"] })).toBe(false);
    });
  });

  describe("given an empty matrix", () => {
    it("reports no pairwise detail", () => {
      expect(winMatrixHasPairwiseDetail({ winMatrix: {}, variantIds: [] })).toBe(false);
    });
  });
});
