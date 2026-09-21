/**
 * @vitest-environment node
 * @unit
 *
 * The p95 a table row is compared against: what counts toward it, and when
 * there is not enough of a page to compare anything at all.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { describe, expect, it } from "vitest";

import { percentileStats } from "../percentile";

describe("percentileStats", () => {
  describe("given fewer than three values carrying something", () => {
    /** @scenario "Too few rows to compare draws no bars" */
    it("reports no stats", () => {
      expect(percentileStats([]).hasStats).toBe(false);
      expect(percentileStats([10]).hasStats).toBe(false);
      expect(percentileStats([10, 20]).hasStats).toBe(false);
      // Zeroes are not values: a page of empty rows describes no distribution.
      expect(percentileStats([0, 0, 0, 40, 50]).hasStats).toBe(false);
    });
  });

  describe("given a page of values", () => {
    it("takes the p95 by nearest rank over the non-zero values", () => {
      const stats = percentileStats([10, 20, 30, 0, 40]);

      expect(stats.hasStats).toBe(true);
      // Four values: rank ceil(4 * 0.95) = 4, which is the largest of them.
      expect(stats.p95).toBe(40);
    });

    it("keeps a single outlier from becoming the whole scale", () => {
      const values = [...Array.from({ length: 19 }, () => 100), 10_000];

      expect(percentileStats(values).p95).toBe(100);
    });

    it("ignores values that are not finite", () => {
      const stats = percentileStats([10, 20, Number.NaN, 30, Infinity]);

      expect(stats.hasStats).toBe(true);
      expect(stats.p95).toBe(30);
    });
  });

  describe("when two columns are measured separately", () => {
    /** @scenario "Tokens and token cost each scale against their own p95" */
    it("gives each column the p95 of its own values", () => {
      const tokens = percentileStats([1_000, 2_000, 3_000]);
      const cost = percentileStats([9, 3, 1]);

      expect(tokens.p95).toBe(3_000);
      expect(cost.p95).toBe(9);
    });
  });

  describe("when a value sits at or past the p95", () => {
    /** @scenario "A row past the p95 is drawn as an outlier" */
    it("puts the value's ratio at or above one", () => {
      const stats = percentileStats([10, 20, 30]);

      expect(30 / stats.p95).toBeGreaterThanOrEqual(1);
      expect(10 / stats.p95).toBeLessThan(1);
    });
  });
});
