/**
 * The home page's precedence rule, exhaustively.
 *
 * Spec: specs/home/signal-focused-home-rollout.feature,
 *       specs/home/langy-home.feature
 */
import { describe, expect, it } from "vitest";
import { resolveHomeComposition } from "../useHomeComposition";

describe("resolveHomeComposition", () => {
  describe("when the signal-focused rollout is on", () => {
    /** @scenario The signal-focused home outranks the Langy home */
    it("wins outright, whatever Langy has", () => {
      for (const showLangy of [false, true]) {
        expect(
          resolveHomeComposition({
            showSignalFocusedHome: true,
            showLangy,
          }),
        ).toBe("signal-focused");
      }
    });

    /** @scenario The page only waits on flags that could change the answer */
    it("decides while Langy's own gate is still answering", () => {
      // Once signal-focused has won, Langy's answer cannot change the
      // outcome — waiting on it would just be a slower page.
      expect(
        resolveHomeComposition({
          showSignalFocusedHome: true,
          showLangy: false,
          langyResolving: true,
        }),
      ).toBe("signal-focused");
    });
  });

  describe("when the signal-focused rollout is off", () => {
    /** @scenario The Langy home renders when the signal-focused home is off */
    it("gives the Langy home to a reader with Langy — no second rollout", () => {
      expect(
        resolveHomeComposition({
          showSignalFocusedHome: false,
          showLangy: true,
        }),
      ).toBe("langy");
    });

    /** @scenario Without Langy the classic home renders */
    it("falls back to classic without Langy", () => {
      expect(
        resolveHomeComposition({
          showSignalFocusedHome: false,
          showLangy: false,
        }),
      ).toBe("classic");
    });

    /** @scenario A reader with no project never waits on a flag that cannot answer */
    it("answers classic at once when both gates report decided-off", () => {
      // With no project, the gate hooks report show:false / resolving:false —
      // decided, not pending — so the resolver never holds the page.
      expect(
        resolveHomeComposition({
          showSignalFocusedHome: false,
          showLangy: false,
          signalFocusedResolving: false,
          langyResolving: false,
        }),
      ).toBe("classic");
    });
  });
});

describe("when a gate the answer depends on has not answered yet", () => {
  /** @scenario The page waits rather than guessing which home it is */
  it("commits to nothing, whatever the gates currently read as", () => {
    // Every gate reports `false` while loading, so without this the resolver
    // would confidently answer "classic" and the page would paint the wrong
    // home before swapping it out.
    for (const showSignalFocusedHome of [false, true]) {
      for (const showLangy of [false, true]) {
        expect(
          resolveHomeComposition({
            showSignalFocusedHome,
            showLangy,
            signalFocusedResolving: true,
          }),
        ).toBe("undecided");
      }
    }
    // Signal-focused answered "off": the Langy branch is now the one that
    // matters, so its gate being in flight still holds the page.
    expect(
      resolveHomeComposition({
        showSignalFocusedHome: false,
        showLangy: false,
        langyResolving: true,
      }),
    ).toBe("undecided");
  });

  /** @scenario The decided home replaces the placeholder once, and never swaps again */
  it("answers normally the moment nothing is in flight", () => {
    expect(
      resolveHomeComposition({
        showSignalFocusedHome: false,
        showLangy: true,
      }),
    ).toBe("langy");
  });
});
