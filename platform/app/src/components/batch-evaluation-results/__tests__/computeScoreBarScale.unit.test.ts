import { describe, expect, it } from "vitest";

import type { BTLeaderboardEntry } from "../computeBTLeaderboard";
import { computeScoreBarScale } from "../LeaderboardVerdictPanel";

/**
 * The score-bar scale, and specifically which entries get a vote on it.
 *
 * This has regressed once already. A review caught degenerate scores blowing
 * out the axis when the bounds came from CI bounds; the rewrite to score-based
 * bounds kept the non-finite guard and dropped the degenerate one, so the same
 * defect came back through a different code path. These tests pin the rule
 * itself rather than the shape of the filter chain.
 */

const entry = (
  variantId: string,
  score: number,
  isDegenerate = false,
): BTLeaderboardEntry => ({
  variantId,
  wins: 1,
  losses: 1,
  matchups: 2,
  winRate: 0.5,
  strength: 1,
  score,
  scoreCI: null,
  isDegenerate,
});

describe("computeScoreBarScale", () => {
  describe("given a degenerate variant with an extreme sink score", () => {
    // The regression. A variant that swept (or was swept) gets a finite but
    // meaningless score; if it sets the axis, every real variant collapses
    // into a sliver and the whole "do the bands overlap" reading is lost.
    it("does not let it set the bounds", () => {
      const withSink = computeScoreBarScale([
        entry("a", 150),
        entry("b", 100),
        entry("swept", -900, true),
      ])!;
      const withoutSink = computeScoreBarScale([entry("a", 150), entry("b", 100)])!;

      expect(withSink.min).toBeCloseTo(withoutSink.min, 6);
      expect(withSink.max).toBeCloseTo(withoutSink.max, 6);
    });

    it("keeps the real variants visually apart", () => {
      const scale = computeScoreBarScale([
        entry("a", 150),
        entry("b", 100),
        entry("swept", -900, true),
      ])!;

      // Before the fix both of these landed above 95% — indistinguishable.
      expect(scale.pct(150) - scale.pct(100)).toBeGreaterThan(20);
    });
  });

  describe("given a non-finite score", () => {
    it("ignores it rather than producing a NaN scale", () => {
      const scale = computeScoreBarScale([
        entry("a", 150),
        entry("b", Number.POSITIVE_INFINITY),
      ])!;

      expect(Number.isFinite(scale.min)).toBe(true);
      expect(Number.isFinite(scale.pct(150))).toBe(true);
    });
  });

  describe("given every variant is degenerate", () => {
    it("returns no scale rather than a degenerate axis", () => {
      expect(
        computeScoreBarScale([entry("a", -900, true), entry("b", 900, true)]),
      ).toBeNull();
    });
  });

  describe("given a single scoreable variant", () => {
    it("still produces a usable scale rather than dividing by zero", () => {
      const scale = computeScoreBarScale([entry("a", 42)])!;

      expect(Number.isFinite(scale.pct(42))).toBe(true);
      expect(scale.pct(42)).toBeGreaterThan(0);
      expect(scale.pct(42)).toBeLessThan(100);
    });
  });

  describe("when a value sits outside the padded bounds", () => {
    it("clamps to the track rather than overflowing it", () => {
      const scale = computeScoreBarScale([entry("a", 0), entry("b", 100)])!;

      // A CI bound wider than the score spread clips at the edge — that is the
      // intended "uncertainty runs off the chart" reading.
      expect(scale.pct(-10_000)).toBe(0);
      expect(scale.pct(10_000)).toBe(100);
    });
  });
});
