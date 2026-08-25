import { describe, expect, it } from "vitest";

import type { ParetoDominance } from "@langwatch/experiment-web";
import { formatTradeoffSummary } from "@langwatch/experiment-web";

/**
 * The sentence is what a reader acts on, so it is held to the same standard
 * as the verdict: it may not describe a comparison the run did not make.
 *
 * @see specs/experiments/comparison-leaderboard.feature
 */

const names = { a: "warm", b: "premium", c: "blunt" };

const dominance = (over: Partial<ParetoDominance>): ParetoDominance => ({
  dimensions: ["quality", "cost", "speed"],
  dominatedBy: { a: [], b: [] },
  front: ["a"],
  edges: [],
  ...over,
});

describe("formatTradeoffSummary", () => {
  describe("given one variant beaten outright", () => {
    const summary = formatTradeoffSummary({
      variantNames: names,
      dominance: dominance({
        dominatedBy: { a: [], b: ["a"] },
        edges: [
          {
            winnerId: "a",
            loserId: "b",
            strictlyBetterOn: ["quality", "cost", "speed"],
          },
        ],
      }),
    })!;

    it("names the loser, the winner, and what was actually won", () => {
      expect(summary.headline).toContain("premium is beaten outright by warm");
      expect(summary.headline).toContain("quality, cost and speed");
    });

    it("marks it as something the reader can act on", () => {
      expect(summary.tone).toBe("actionable");
      expect(summary.droppableIds).toEqual(["b"]);
    });
  });

  describe("given a win on cost and speed but a quality tie", () => {
    it("does not list quality among what was won", () => {
      // The chart shows a higher point; the intervals overlap. Naming quality
      // here would assert a separation this run cannot see.
      const summary = formatTradeoffSummary({
        variantNames: names,
        dominance: dominance({
          dominatedBy: { a: [], b: ["a"] },
          edges: [
            {
              winnerId: "a",
              loserId: "b",
              strictlyBetterOn: ["cost", "speed"],
            },
          ],
        }),
      })!;

      expect(summary.headline).toContain("better on cost and speed");
      expect(summary.headline).not.toContain("quality,");
    });
  });

  describe("given nothing is dominated", () => {
    it("says so rather than staying silent", () => {
      // Silence would be indistinguishable from a check that never ran.
      const summary = formatTradeoffSummary({
        variantNames: names,
        dominance: dominance({ front: ["a", "b"] }),
      })!;

      expect(summary.headline).toContain("No variant is beaten outright");
      expect(summary.headline).toContain("genuine trade-off");
      expect(summary.tone).toBe("neutral");
      expect(summary.droppableIds).toEqual([]);
    });

    it("names the dimensions it actually compared", () => {
      const summary = formatTradeoffSummary({
        variantNames: names,
        dominance: dominance({
          dimensions: ["quality", "cost"],
          front: ["a", "b"],
        }),
      })!;

      expect(summary.headline).toContain("quality and cost");
      expect(summary.headline).not.toContain("speed");
    });
  });

  describe("given quality was the only comparable dimension", () => {
    it("declines to call it a trade-off at all", () => {
      // Dominance over one dimension is just the score ordering the
      // leaderboard already shows. Reporting it as "beaten outright" would
      // imply cost and duration were weighed and lost.
      const summary = formatTradeoffSummary({
        variantNames: names,
        dominance: dominance({
          dimensions: ["quality"],
          dominatedBy: { a: [], b: ["a"] },
          edges: [{ winnerId: "a", loserId: "b", strictlyBetterOn: ["quality"] }],
        }),
      })!;

      expect(summary.tone).toBe("neutral");
      expect(summary.droppableIds).toEqual([]);
      expect(summary.headline).not.toContain("beaten outright");
      expect(summary.headline).toContain("no cost or duration was recorded");
    });
  });

  describe("given several variants beaten outright", () => {
    it("lists each with everything that beats it", () => {
      const summary = formatTradeoffSummary({
        variantNames: names,
        dominance: dominance({
          dominatedBy: { a: [], b: ["a"], c: ["a", "b"] },
          front: ["a"],
          edges: [
            { winnerId: "a", loserId: "b", strictlyBetterOn: ["cost"] },
            { winnerId: "a", loserId: "c", strictlyBetterOn: ["quality"] },
            { winnerId: "b", loserId: "c", strictlyBetterOn: ["speed"] },
          ],
        }),
      })!;

      expect(summary.headline).toContain("2 variants are beaten outright");
      expect(summary.headline).toContain("premium (by warm)");
      expect(summary.headline).toContain("blunt (by warm and premium)");
      expect(summary.droppableIds).toEqual(["b", "c"]);
    });
  });

  describe("given a single ranked variant", () => {
    it("says nothing, because one variant is not a trade-off", () => {
      expect(
        formatTradeoffSummary({
          variantNames: names,
          dominance: dominance({ dominatedBy: { a: [] }, front: ["a"] }),
        }),
      ).toBeNull();
    });
  });

  describe("given a variant with no display name", () => {
    it("falls back to its id rather than rendering undefined", () => {
      const summary = formatTradeoffSummary({
        variantNames: {},
        dominance: dominance({
          dominatedBy: { a: [], b: ["a"] },
          edges: [{ winnerId: "a", loserId: "b", strictlyBetterOn: ["cost"] }],
        }),
      })!;

      expect(summary.headline).toContain("b is beaten outright by a");
      expect(summary.headline).not.toContain("undefined");
    });
  });
});

describe("formatTradeoffSummary — 'the rest' has to exist", () => {
  describe("given the winner won on every compared dimension", () => {
    it("does not refer to dimensions it did not win", () => {
      // "better on quality, cost and speed, and no worse on the rest" —
      // there is no rest. A clause that points at nothing is the small
      // version of the same fault this whole feature exists to avoid.
      const summary = formatTradeoffSummary({
        variantNames: names,
        dominance: dominance({
          dimensions: ["quality", "cost", "speed"],
          dominatedBy: { a: [], b: ["a"] },
          edges: [
            {
              winnerId: "a",
              loserId: "b",
              strictlyBetterOn: ["quality", "cost", "speed"],
            },
          ],
        }),
      })!;

      expect(summary.headline).toContain("better on quality, cost and speed");
      expect(summary.headline).not.toContain("no worse on the rest");
    });
  });

  describe("given the winner tied on one dimension", () => {
    it("still says it was no worse there", () => {
      const summary = formatTradeoffSummary({
        variantNames: names,
        dominance: dominance({
          dimensions: ["quality", "cost", "speed"],
          dominatedBy: { a: [], b: ["a"] },
          edges: [
            {
              winnerId: "a",
              loserId: "b",
              strictlyBetterOn: ["quality", "cost"],
            },
          ],
        }),
      })!;

      expect(summary.headline).toContain("no worse on the rest");
    });
  });
});
