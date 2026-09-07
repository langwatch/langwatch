import { describe, expect, it } from "vitest";
import { toastActionColor } from "../toaster";

/**
 * A toast's action carries the accent. On a toast that already reads as good
 * news, the warm accent reads as a warning about it: the confirmation for
 * traces sent to an annotation queue offered "View queue" in the same colour a
 * failure would use.
 *
 * Light mode fills the three status toasts with a solid colour, and there the
 * action inherits the contrast colour the fill sets — an accent has nothing to
 * sit on. The accent is what dark mode's panel uses.
 */
describe("given a toast carrying an action", () => {
  describe("when the toast says something went right", () => {
    /** @scenario "A filled toast drops the accent its panel would use" */
    it("reads the action in the same green the toast does", () => {
      expect(toastActionColor("success")).toEqual({
        _light: "inherit",
        _dark: "green.fg",
      });
    });
  });

  describe("when the toast reports trouble", () => {
    /** @scenario "A filled toast drops the accent its panel would use" */
    it("keeps the accent on the action, on the panel", () => {
      expect(toastActionColor("error")).toEqual({
        _light: "inherit",
        _dark: "orange.fg",
      });
      expect(toastActionColor("warning")).toEqual({
        _light: "inherit",
        _dark: "orange.fg",
      });
    });
  });

  describe("when no mode fills the toast", () => {
    /** @scenario "A toast that is a card in both modes keeps its accent" */
    it("keeps the accent in both modes", () => {
      expect(toastActionColor("info")).toBe("orange.fg");
      expect(toastActionColor("loading")).toBe("orange.fg");
      expect(toastActionColor(undefined)).toBe("orange.fg");
    });
  });
});
