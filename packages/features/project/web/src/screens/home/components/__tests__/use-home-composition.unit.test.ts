/**
 * The home page's precedence rule: without Langy and without the
 * signal-focused rollout, the classic home renders.
 *
 * Ported from platform/app/src/components/home/__tests__/useHomeComposition.unit.test.ts
 * (origin/main); the function's own shape is unchanged by the move. This file
 * covers only the langy-home.feature scenario — the signal-focused-home-
 * rollout.feature scenarios in the same origin file are ported separately.
 * See specs/home/langy-home.feature.
 */
import { describe, expect, it } from "vitest";
import { resolveHomeComposition } from "../use-home-composition";

describe("resolveHomeComposition", () => {
  describe("when the signal-focused rollout is off", () => {
    /** @scenario Without Langy the classic home renders */
    it("falls back to classic without Langy", () => {
      expect(resolveHomeComposition({ showSignalFocusedHome: false, showLangy: false })).toBe(
        "classic",
      );
    });
  });
});
