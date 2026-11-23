import { describe, expect, it } from "vitest";

import { fitDrawerWidth } from "../drawer-fit.ts";

const base = { viewportWidth: 1280, rightReservePx: 8, minPx: 360 };

describe("fitDrawerWidth", () => {
  describe("given a preferred width that reaches over the Ask Langy button", () => {
    /** @scenario "A wide trace drawer leaves the Ask Langy button visible" */
    it("stops the drawer's left edge a gap to the right of the button", () => {
      const width = fitDrawerWidth({ ...base, preferredPx: 1200, keepClearRightPx: 323 });

      expect(1280 - 8 - width).toBe(323 + 12);
    });
  });

  describe("given a preferred width that fits beside the button", () => {
    it("keeps the preferred width", () => {
      expect(fitDrawerWidth({ ...base, preferredPx: 700, keepClearRightPx: 323 })).toBe(700);
    });
  });

  describe("given the docked Langy panel holds the right edge", () => {
    /** @scenario "Opening Langy beside a wide trace drawer narrows the drawer" */
    it("narrows the drawer instead of sliding it over the button", () => {
      const alone = fitDrawerWidth({ ...base, preferredPx: 1200, keepClearRightPx: 323 });
      const withLangy = fitDrawerWidth({
        ...base,
        preferredPx: 1200,
        keepClearRightPx: 323,
        rightReservePx: 8 + 392 + 12,
      });

      expect(withLangy).toBe(alone - 392 - 12);
      expect(1280 - (8 + 392 + 12) - withLangy).toBe(323 + 12);
    });
  });

  describe("given no control to keep clear", () => {
    it("leaves only the edge margin on the left", () => {
      expect(fitDrawerWidth({ ...base, preferredPx: 5000, keepClearRightPx: null })).toBe(
        1280 - 8 - 8,
      );
    });
  });

  describe("given a narrow window", () => {
    it("never goes below the minimum width", () => {
      expect(
        fitDrawerWidth({ ...base, viewportWidth: 600, preferredPx: 900, keepClearRightPx: 323 }),
      ).toBe(360);
    });
  });
});
