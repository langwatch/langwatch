import { describe, expect, it } from "vitest";

import { toastActionColor } from "../src/components/toaster.tsx";

/**
 * Toast action color: light mode uses the status color's contrast, dark mode
 * uses the accent color.
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
      expect(toastActionColor(void 0)).toBe("orange.fg");
    });
  });
});
