import { describe, expect, it } from "vitest";

import type { LeaderboardVerdict } from "../computeLeaderboardVerdict";
import { formatLeaderboardHeadline } from "../formatLeaderboardHeadline";

const NAMES = { a: "warm", b: "warm-premium", c: "blunt" };

describe("formatLeaderboardHeadline", () => {
  describe("given one variant beats every other beyond the margin", () => {
    /** @scenario "The answer is one sentence, before any chart" */
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

      // NOT "same quality". This branch is reached when two confidence
      // intervals overlap, which means the run failed to separate them — it
      // is not a measurement of equivalence, and no non-inferiority test was
      // run. The distinction matters here more than anywhere else in the
      // feature: this heading is the only string the compact card renders, so
      // it is the sentence most readers act on.
      expect(headline.heading).toBe("Ship warm — not separated on quality, 75% cheaper");
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

      expect(headline.heading).toBe("Ship warm — top of the ranking and 75% cheaper");
      expect(headline.tone).toBe("positive");
    });
  });

  describe("given the top two are tied with no cost difference", () => {
    /** @scenario "The headline never claims a winner the run cannot support" */
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

describe("formatLeaderboardHeadline — the mechanism it names must be the one used", () => {
  describe("given a clear winner whose printed range overlaps a rival's", () => {
    it("does not claim it cleared every margin of error", () => {
      // Separation is decided on the uncertainty of the GAP, which is
      // tighter than either printed margin. So a legitimate clear winner
      // can fail to clear those margins — and this sentence asserted it
      // had, which is a stronger claim than the one that was tested.
      const headline = formatLeaderboardHeadline({
        verdict: { kind: "clear-winner", leaderId: "a", tiedIds: ["a"] },
        cheaperAlternative: null,
        variantNames: { a: "warm", b: "premium" },
      });

      expect(headline.heading).toContain("Ship warm");
      expect(headline.detail).not.toContain("margin of error");
    });
  });

  describe("given a tie at the top", () => {
    it("says the run did not separate them without naming the wrong test", () => {
      const headline = formatLeaderboardHeadline({
        verdict: { kind: "tie-at-top", leaderId: "a", tiedIds: ["a", "b"] },
        cheaperAlternative: null,
        variantNames: { a: "warm", b: "premium" },
      });

      expect(headline.detail).toContain("does not establish a winner");
      expect(headline.detail).not.toContain("within each other's margin of error");
    });
  });
});

describe("formatLeaderboardHeadline — a saving is never rounded to free", () => {
  describe("given a variant that costs a tiny fraction of the one it ties with", () => {
    it("caps the quoted saving at 99%", () => {
      // $0.00004 against $0.012 is a 99.7% saving, which rounds to 100 and
      // then reads as "100% cheaper" — free. The cheapest variant in a real
      // run costs something, and the headline should not say otherwise.
      const headline = formatLeaderboardHeadline({
        verdict: { kind: "tie-at-top", leaderId: "a", tiedIds: ["a", "b"] },
        cheaperAlternative: {
          variantId: "a",
          cost: 0.00004,
          dearestCost: 0.012,
          savingRatio: 0.9967,
          isLeader: true,
        },
        variantNames: { a: "warm", b: "premium" },
      });

      expect(headline.heading).toContain("99% cheaper");
      expect(headline.heading).not.toContain("100% cheaper");
    });
  });

  describe("given an ordinary saving", () => {
    it("reports it unrounded, so the cap is not swallowing real numbers", () => {
      const headline = formatLeaderboardHeadline({
        verdict: { kind: "tie-at-top", leaderId: "a", tiedIds: ["a", "b"] },
        cheaperAlternative: {
          variantId: "a",
          cost: 0.002,
          dearestCost: 0.008,
          savingRatio: 0.75,
          isLeader: true,
        },
        variantNames: { a: "warm", b: "premium" },
      });

      expect(headline.heading).toContain("75% cheaper");
    });
  });
});
