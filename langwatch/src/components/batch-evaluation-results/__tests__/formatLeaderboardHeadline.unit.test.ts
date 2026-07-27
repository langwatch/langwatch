import { describe, expect, it } from "vitest";

import type { LeaderboardVerdict } from "../computeLeaderboardVerdict";
import { formatLeaderboardHeadline } from "../formatLeaderboardHeadline";

const NAMES = { a: "warm", b: "warm-premium", c: "blunt" };

describe("formatLeaderboardHeadline", () => {
  describe("given one variant beats every other beyond the margin", () => {
    it("names it as the one to ship", () => {
      const headline = formatLeaderboardHeadline({
        verdict: {
          kind: "clear-winner",
          leaderId: "a",
          tiedIds: ["a"],
        } satisfies LeaderboardVerdict,
        cheaperAlternative: null,
        variantNames: NAMES,
      });

      expect(headline.heading).toBe("Ship warm");
      expect(headline.tone).toBe("positive");
    });
  });

  describe("given the top two are tied and one is much cheaper", () => {
    it("turns the tie into a cost decision instead of a shrug", () => {
      const headline = formatLeaderboardHeadline({
        verdict: {
          kind: "tie-at-top",
          leaderId: "b",
          tiedIds: ["b", "a"],
        } satisfies LeaderboardVerdict,
        cheaperAlternative: {
          variantId: "a",
          cost: 0.00175,
          dearestCost: 0.00687,
          savingRatio: 0.745,
          isLeader: false,
        },
        variantNames: NAMES,
      });

      expect(headline.heading).toBe("Ship warm — same quality, 75% cheaper");
      expect(headline.detail).toContain("warm-premium and warm");
      expect(headline.tone).toBe("positive");
    });
  });

  describe("given the leader is itself the cheapest of the tied set", () => {
    // The strongest outcome the chart can produce — top of the ranking AND
    // cheapest to run — used to fall through to "too close to call".
    it("names it and says it leads on both", () => {
      const headline = formatLeaderboardHeadline({
        verdict: {
          kind: "tie-at-top",
          leaderId: "a",
          tiedIds: ["a", "b"],
        } satisfies LeaderboardVerdict,
        cheaperAlternative: {
          variantId: "a",
          cost: 0.00175,
          dearestCost: 0.00687,
          savingRatio: 0.745,
          isLeader: true,
        },
        variantNames: NAMES,
      });

      expect(headline.heading).toBe(
        "Ship warm — top of the ranking and 75% cheaper",
      );
      expect(headline.tone).toBe("positive");
    });
  });

  describe("given the top two are tied with no cost difference", () => {
    it("refuses to name a winner", () => {
      const headline = formatLeaderboardHeadline({
        verdict: {
          kind: "tie-at-top",
          leaderId: "a",
          tiedIds: ["a", "b"],
        } satisfies LeaderboardVerdict,
        cheaperAlternative: null,
        variantNames: NAMES,
      });

      expect(headline.heading).toBe("Too close to call");
      expect(headline.heading).not.toContain("Ship");
      expect(headline.tone).toBe("caution");
    });
  });

  describe("given three variants tied at the top", () => {
    it("lists them as prose rather than a comma run-on", () => {
      const headline = formatLeaderboardHeadline({
        verdict: {
          kind: "tie-at-top",
          leaderId: "a",
          tiedIds: ["a", "b", "c"],
        } satisfies LeaderboardVerdict,
        cheaperAlternative: null,
        variantNames: NAMES,
      });

      expect(headline.detail).toContain("warm, warm-premium and blunt");
    });
  });

  describe("given too few resolved comparisons to rank", () => {
    it("says there is no ranking rather than picking the top row", () => {
      const headline = formatLeaderboardHeadline({
        verdict: {
          kind: "no-signal",
          leaderId: null,
          tiedIds: [],
        } satisfies LeaderboardVerdict,
        cheaperAlternative: null,
        variantNames: NAMES,
      });

      expect(headline.heading).toBe("No ranking yet");
      expect(headline.tone).toBe("neutral");
    });
  });

  describe("when a variant has no display name", () => {
    it("falls back to its id instead of rendering undefined", () => {
      const headline = formatLeaderboardHeadline({
        verdict: {
          kind: "clear-winner",
          leaderId: "unnamed",
          tiedIds: ["unnamed"],
        } satisfies LeaderboardVerdict,
        cheaperAlternative: null,
        variantNames: {},
      });

      expect(headline.heading).toBe("Ship unnamed");
    });
  });

  describe("given a sub-cent cost gap", () => {
    it("shows enough decimal places for the numbers to differ", () => {
      const headline = formatLeaderboardHeadline({
        verdict: {
          kind: "tie-at-top",
          leaderId: "b",
          tiedIds: ["b", "a"],
        } satisfies LeaderboardVerdict,
        cheaperAlternative: {
          variantId: "a",
          cost: 0.0002,
          dearestCost: 0.0019,
          savingRatio: 0.894,
          isLeader: false,
        },
        variantNames: NAMES,
      });

      expect(headline.detail).toContain("$0.0002");
      expect(headline.detail).toContain("$0.0019");
    });
  });
});
