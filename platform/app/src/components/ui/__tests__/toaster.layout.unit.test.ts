import { describe, expect, it } from "vitest";
import { LIGHT_MODE_ELEVATION, SYMMETRIC_PADDING_END } from "../toaster";

/**
 * #6716: the toast card read as off-centre and didn't read as a toast at
 * all, worst in light mode — a regression from the error-handling redesign
 * pass. Two root causes, both regression-guarded here:
 *
 *  - Chakra's base toast recipe pads `pe: "6"` against `ps: "4"` to leave
 *    room for an ABSOLUTELY positioned close button. This app's close
 *    trigger is `position="static"` (a real flex sibling), so that extra
 *    end padding was dead space with nothing in it — the content read as
 *    shifted toward the start.
 *  - The `lg` shadow token is ~10% opacity in light mode (vs 64% in dark),
 *    tuned for a panel that's expected to sit there, not a card that has to
 *    separate itself from the page in the half-second before anyone looks.
 */
describe("given the toast card's material", () => {
  describe("when there is no close button to reserve space for", () => {
    /** @scenario A toast without a close button is not shifted off-centre */
    it("pads symmetrically, matching the recipe's own start padding", () => {
      // Chakra's toast recipe (`ps: "4"`) is the other half of the pair this
      // must match — see the comment above `SYMMETRIC_PADDING_END`.
      expect(SYMMETRIC_PADDING_END).toBe("4");
    });
  });

  describe("when the toast renders in light mode", () => {
    it("uses a stronger elevation than the flat 'lg' token", () => {
      // Not itself "lg" (the base recipe's weak, mostly-transparent value in
      // light mode) and carries a real spread + a defined ring so the card
      // separates from a near-white page.
      expect(LIGHT_MODE_ELEVATION).not.toBe("lg");
      expect(LIGHT_MODE_ELEVATION).toContain("color-mix");
    });
  });
});
