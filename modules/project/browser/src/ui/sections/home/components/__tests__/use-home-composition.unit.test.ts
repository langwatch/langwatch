/**
 * The home page's composition rule, exhaustively.
 * Spec: specs/home/langy-home.feature
 */
import { describe, expect, it } from "vitest";

import { resolveHomeComposition } from "../use-home-composition.ts";

describe("resolveHomeComposition", () => {
  describe("when Langy's gate has answered", () => {
    /** @scenario The Langy home renders for a reader with Langy */
    it("gives the Langy home to a reader with Langy — no second rollout", () => {
      expect(resolveHomeComposition({ showLangy: true })).toBe("langy");
    });

    /** @scenario Without Langy the classic home renders */
    it("falls back to classic without Langy", () => {
      expect(resolveHomeComposition({ showLangy: false })).toBe("classic");
    });

    /** @scenario A reader with no project never waits on a flag that cannot answer */
    it("answers classic at once when the gate reports decided-off", () => {
      expect(resolveHomeComposition({ showLangy: false, langyResolving: false })).toBe("classic");
    });
  });
});

describe("when the gate the answer depends on has not answered yet", () => {
  /** @scenario The page waits rather than guessing which home it is */
  it("commits to nothing, whatever the gate currently reads as", () => {
    for (const showLangy of [false, true]) {
      expect(resolveHomeComposition({ showLangy, langyResolving: true })).toBe("undecided");
    }
  });

  /** @scenario The decided home replaces the placeholder once, and never swaps again */
  it("answers normally the moment nothing is in flight", () => {
    expect(resolveHomeComposition({ showLangy: true })).toBe("langy");
  });
});
