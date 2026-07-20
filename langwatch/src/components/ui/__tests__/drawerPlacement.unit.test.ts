/**
 * Drawers yield the right edge while the Langy panel is open, every `end`
 * placement (explicit or defaulted) resolves to `start`; other anchors are
 * untouched. Spec: specs/langy/langy-panel-layout.feature
 */
import { describe, expect, it } from "vitest";
import { resolveDrawerPlacement } from "../drawer";

describe("resolveDrawerPlacement", () => {
  describe("when the Langy panel is open", () => {
    it("moves a right-anchored drawer to the left", () => {
      expect(resolveDrawerPlacement(true, "end")).toBe("start");
    });

    it("moves the defaulted (unspecified) placement to the left", () => {
      expect(resolveDrawerPlacement(true, undefined)).toBe("start");
    });

    it("leaves other anchors untouched", () => {
      expect(resolveDrawerPlacement(true, "start")).toBe("start");
      expect(resolveDrawerPlacement(true, "bottom")).toBe("bottom");
      expect(resolveDrawerPlacement(true, "top")).toBe("top");
    });
  });

  describe("when the Langy panel is closed", () => {
    it("keeps drawers on the right edge", () => {
      expect(resolveDrawerPlacement(false, "end")).toBe("end");
      expect(resolveDrawerPlacement(false, undefined)).toBe("end");
    });
  });
});
