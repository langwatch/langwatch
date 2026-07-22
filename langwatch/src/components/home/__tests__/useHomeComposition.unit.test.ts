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
        for (const langyHomeEnabled of [false, true]) {
          expect(
            resolveHomeComposition({
              showSignalFocusedHome: true,
              showLangy,
              langyHomeEnabled,
            }),
          ).toBe("signal-focused");
        }
      }
    });
  });

  describe("when the signal-focused rollout is off", () => {
    /** @scenario The Langy home renders when the signal-focused home is off */
    it("gives the Langy home to a reader who has both Langy and its rollout", () => {
      expect(
        resolveHomeComposition({
          showSignalFocusedHome: false,
          showLangy: true,
          langyHomeEnabled: true,
        }),
      ).toBe("langy");
    });

    /** @scenario The Langy home needs its own rollout, not just Langy */
    it("falls back to classic when Langy is there but its rollout is not", () => {
      expect(
        resolveHomeComposition({
          showSignalFocusedHome: false,
          showLangy: true,
          langyHomeEnabled: false,
        }),
      ).toBe("classic");
    });

    /** @scenario Without Langy the rollout alone changes nothing */
    it("falls back to classic when the rollout is there but Langy is not", () => {
      expect(
        resolveHomeComposition({
          showSignalFocusedHome: false,
          showLangy: false,
          langyHomeEnabled: true,
        }),
      ).toBe("classic");
    });

    it("falls back to classic when neither is there", () => {
      expect(
        resolveHomeComposition({
          showSignalFocusedHome: false,
          showLangy: false,
          langyHomeEnabled: false,
        }),
      ).toBe("classic");
    });
  });
});
