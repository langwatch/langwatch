import { describe, expect, it } from "vitest";

import {
  clippedBandMask,
  computeBandClipping,
  computeScoreBarScale,
} from "../leaderboard-verdict-panel";
import type { BTLeaderboardEntry } from "../../../../model/batch-evaluation-results.bt-leaderboard";

/**
 * The score bars scale to the SCORES, not to the intervals, so a wide
 * interval routinely runs past both bounds and gets clamped onto the track.
 *
 * Clamping on its own understates uncertainty: a band sliced off at the edge
 * paints exactly like a band that genuinely stops there, and the reader sees
 * a tighter estimate than the run supports. These cover the detection half —
 * which edges ran over — so the fade cue cannot silently stop firing.
 */

const entry = (variantId: string, score: number, isDegenerate = false): BTLeaderboardEntry => ({
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

describe("computeBandClipping", () => {
  describe("given an interval inside the axis bounds", () => {
    it("reports neither edge clipped", () => {
      expect(computeBandClipping({ ci: [10, 20], min: 0, max: 100 })).toEqual({
        start: false,
        end: false,
      });
    });
  });

  describe("given an interval running past one bound", () => {
    it("reports the lower edge clipped", () => {
      expect(computeBandClipping({ ci: [-5, 20], min: 0, max: 100 })).toEqual({
        start: true,
        end: false,
      });
    });

    it("reports the upper edge clipped", () => {
      expect(computeBandClipping({ ci: [10, 140], min: 0, max: 100 })).toEqual({
        start: false,
        end: true,
      });
    });
  });

  describe("given an interval wider than the whole axis", () => {
    it("reports both edges clipped", () => {
      expect(computeBandClipping({ ci: [-50, 150], min: 0, max: 100 })).toEqual({
        start: true,
        end: true,
      });
    });
  });

  describe("given an interval exactly touching a bound", () => {
    // Landing on the bound is not running past it — the band really does end
    // there, so fading it would claim uncertainty the run does not have.
    it("reports no clipping", () => {
      expect(computeBandClipping({ ci: [0, 100], min: 0, max: 100 })).toEqual({
        start: false,
        end: false,
      });
    });
  });

  describe("when paired with the real axis scale", () => {
    // The scale pads by 10% of the score spread, so an interval only a little
    // wider than that spread already overruns it. This is the common case on
    // small samples, not an edge case.
    it("detects the overrun a bootstrap on few comparisons produces", () => {
      const scale = computeScoreBarScale([entry("A", 100), entry("B", 80), entry("C", 60)]);
      expect(scale).not.toBeNull();

      const wide = computeBandClipping({
        ci: [-200, 400],
        min: scale!.min,
        max: scale!.max,
      });
      expect(wide).toEqual({ start: true, end: true });
    });
  });
});

describe("clippedBandMask", () => {
  describe("given no clipped edge", () => {
    it("returns no mask, leaving the band solid", () => {
      expect(clippedBandMask({ start: false, end: false })).toBeUndefined();
    });
  });

  describe("given a clipped edge", () => {
    it("fades the start", () => {
      expect(clippedBandMask({ start: true, end: false })).toContain("to right");
    });

    it("fades the end", () => {
      expect(clippedBandMask({ start: false, end: true })).toContain("to left");
    });

    it("fades both", () => {
      const mask = clippedBandMask({ start: true, end: true });
      // Transparent at 0% and 100%, opaque between — both ends read as
      // "continues", rather than one end being arbitrarily chosen.
      expect(mask).toContain("transparent 0%");
      expect(mask).toContain("transparent 100%");
    });
  });
});
