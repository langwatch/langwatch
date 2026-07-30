import { describe, expect, it } from "vitest";

import type { BatchComparisonColumn } from "../types";
import { leaderboardFor } from "../useBTLeaderboard";
import { variantMetricsFor } from "../useVariantMetrics";

/**
 * The caches exist so the fit runs once per answer rather than once per
 * render. Keyed on object identity they did the opposite while a run was
 * live: the results page polls every second and rebuilds its transformed data
 * from each response, so every poll handed the cache a brand-new object and
 * missed — running the full bootstrap synchronously on the render thread once
 * a second, for as long as anyone watched.
 *
 * These assert on REFERENCE equality, because that is the only thing that
 * distinguishes a cache hit from a recomputation that happened to agree.
 *
 * @see specs/experiments/comparison-leaderboard.feature
 */

const VARIANTS = ["a", "b", "c"];

/** A fresh object each call, structurally identical — what a poll produces. */
const columnFromPoll = (rowCount: number): BatchComparisonColumn => ({
  evaluatorId: "comparison-1",
  name: "Comparison",
  variants: VARIANTS.map((id) => ({ id, name: id })),
  verdictsByRow: Object.fromEntries(
    Array.from({ length: rowCount }, (_, rowIndex) => [
      rowIndex,
      {
        rowIndex,
        winnerId: VARIANTS[rowIndex % VARIANTS.length]!,
        candidateIds: VARIANTS,
        reasoning: "that one read better",
      },
    ]),
  ),
});

const rowsFromPoll = (rowCount: number) =>
  Array.from({ length: rowCount }, (_, index) => ({
    index,
    datasetEntry: { input: "test" },
    targets: Object.fromEntries(
      VARIANTS.map((id) => [
        id,
        {
          targetId: id,
          output: { output: "response" },
          cost: 0.001,
          duration: 500,
          error: null,
          traceId: null,
          evaluatorResults: [],
        },
      ]),
    ),
  })) as any;

describe("leaderboardFor", () => {
  describe("when a poll rebuilds the column but nothing was judged since", () => {
    it("returns the same fit rather than recomputing it", () => {
      const first = leaderboardFor({
        column: columnFromPoll(9),
        variantIds: VARIANTS,
        options: { bootstrapSamples: 0 },
      });
      const second = leaderboardFor({
        column: columnFromPoll(9),
        variantIds: VARIANTS,
        options: { bootstrapSamples: 0 },
      });

      expect(second).toBe(first);
    });
  });

  describe("when the poll brought a new verdict", () => {
    it("recomputes, so the cache cannot serve a stale ranking", () => {
      const before = leaderboardFor({
        column: columnFromPoll(9),
        variantIds: VARIANTS,
        options: { bootstrapSamples: 0 },
      });
      const after = leaderboardFor({
        column: columnFromPoll(12),
        variantIds: VARIANTS,
        options: { bootstrapSamples: 0 },
      });

      expect(after).not.toBe(before);
      expect(after.comparisonCount).toBeGreaterThan(before.comparisonCount);
    });
  });
});

describe("variantMetricsFor", () => {
  describe("when a poll rebuilds the rows but no target reported anything new", () => {
    it("returns the same statistics rather than recomputing them", () => {
      const first = variantMetricsFor({
        rows: rowsFromPoll(6),
        variantIds: VARIANTS,
      });
      const second = variantMetricsFor({
        rows: rowsFromPoll(6),
        variantIds: VARIANTS,
      });

      expect(second).toBe(first);
    });
  });

  describe("when a row arrived", () => {
    it("recomputes", () => {
      const before = variantMetricsFor({
        rows: rowsFromPoll(6),
        variantIds: VARIANTS,
      });
      const after = variantMetricsFor({
        rows: rowsFromPoll(7),
        variantIds: VARIANTS,
      });

      expect(after).not.toBe(before);
    });
  });
});
