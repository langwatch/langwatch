import { describe, expect, it } from "vitest";
import { toastActionColor } from "../toaster";

/**
 * A toast's action carries the accent. On a toast that already reads as good
 * news, the warm accent reads as a warning about it: the confirmation for
 * traces sent to an annotation queue offered "View queue" in the same colour a
 * failure would use.
 */
describe("given a toast carrying an action", () => {
  describe("when the toast says something went right", () => {
    it("reads the action in the same green the toast does", () => {
      expect(toastActionColor("success")).toBe("green.fg");
    });
  });

  describe("when the toast says anything else", () => {
    it("keeps the accent on the action", () => {
      expect(toastActionColor("error")).toBe("orange.fg");
      expect(toastActionColor("warning")).toBe("orange.fg");
      expect(toastActionColor("info")).toBe("orange.fg");
      expect(toastActionColor("loading")).toBe("orange.fg");
      expect(toastActionColor(undefined)).toBe("orange.fg");
    });
  });
});
