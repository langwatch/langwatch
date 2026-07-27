import { describe, expect, it } from "vitest";

import { featureByKey } from "../../../modelProviders/featureRegistry";
import {
  buildExplanationPrompt,
  LEADERBOARD_SUMMARY_FEATURE_KEY,
  type LeaderboardExplanationFacts,
} from "../leaderboardExplanation";

const facts = (
  overrides: Partial<LeaderboardExplanationFacts> = {},
): LeaderboardExplanationFacts => ({
  verdictKind: "tie-at-top",
  headline: "Ship warm — same quality, 75% cheaper",
  headlineDetail:
    "warm-premium and warm score too closely for this run to separate them.",
  comparisonCount: 60,
  separatedPairs: 5,
  totalPairs: 6,
  entries: [
    {
      name: "warm",
      score: 147,
      ciLow: 68,
      ciHigh: 230,
      winRate: 0.43,
      matchups: 60,
      degenerate: false,
      avgCost: 0.00175,
      avgDurationMs: 9418,
    },
    {
      name: "blunt",
      score: -140,
      ciLow: -346,
      ciHigh: -35,
      winRate: 0.08,
      matchups: 60,
      degenerate: false,
      avgCost: 0.00026,
      avgDurationMs: 4873,
    },
  ],
  checks: [
    { label: "Judge independence", detail: "Judged by X.", tone: "ok" },
    { label: "Answer length", detail: "2.4× the field.", tone: "note" },
  ],
  ...overrides,
});

describe("leaderboard summary feature registration", () => {
  // The whole point of routing this through the registry is that the
  // workspace picks the model. A missing registration would make the
  // endpoint throw at call time rather than at boot.
  it("is registered on the cheap FAST role", () => {
    const feature = featureByKey(LEADERBOARD_SUMMARY_FEATURE_KEY);

    expect(feature).toBeDefined();
    expect(feature?.role).toBe("FAST");
  });
});

describe("buildExplanationPrompt", () => {
  describe("given a computed result", () => {
    it("puts the already-shown conclusion in front of the model", () => {
      const prompt = buildExplanationPrompt(facts());

      expect(prompt).toContain("Ship warm — same quality, 75% cheaper");
      expect(prompt).toContain("ALREADY been computed");
    });

    it("forbids naming a different winner or reshaping the verdict", () => {
      const prompt = buildExplanationPrompt(facts());

      expect(prompt).toContain("Do NOT name a different winner");
      expect(prompt).toContain(
        "do not soften a tie into a winner or harden a winner into a tie",
      );
    });

    it("forbids inventing figures and forecasting a required sample", () => {
      const prompt = buildExplanationPrompt(facts());

      expect(prompt).toContain("Do not estimate, extrapolate, or invent");
      expect(prompt).toContain(
        "do not predict how many more rows would settle anything",
      );
    });

    it("states that overlapping ranges are not distinguishable", () => {
      const prompt = buildExplanationPrompt(facts());

      expect(prompt).toContain(
        "plausible ranges overlap are NOT distinguishable",
      );
    });

    it("carries each variant's score, interval, cost and latency", () => {
      const prompt = buildExplanationPrompt(facts());

      expect(prompt).toContain("warm: score 147");
      expect(prompt).toContain("plausible range 68 to 230");
      expect(prompt).toContain("$0.0018");
      expect(prompt).toContain("9418ms");
    });

    it("carries the trust checks with their tone", () => {
      const prompt = buildExplanationPrompt(facts());

      expect(prompt).toContain("[ok] Judge independence");
      expect(prompt).toContain("[note] Answer length");
    });
  });

  describe("given a variant with no confidence interval", () => {
    it("renders a dash rather than the string null", () => {
      const prompt = buildExplanationPrompt(
        facts({
          entries: [
            {
              name: "swept",
              score: -900,
              ciLow: null,
              ciHigh: null,
              winRate: null,
              matchups: 4,
              degenerate: true,
              avgCost: null,
              avgDurationMs: null,
            },
          ],
        }),
      );

      expect(prompt).toContain("plausible range — to —");
      expect(prompt).not.toContain("null");
      expect(prompt).toContain("never won or never lost");
    });
  });

  describe("given no rankable variants", () => {
    it("says so rather than emitting an empty section", () => {
      const prompt = buildExplanationPrompt(facts({ entries: [] }));

      expect(prompt).toContain("(no rankable variants)");
    });
  });
});
