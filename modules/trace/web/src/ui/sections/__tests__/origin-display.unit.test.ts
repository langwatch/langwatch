import { describe, expect, it } from "vitest";
import { ORIGIN_DISPLAY, originColorPalette, originLabel } from "../../../model/origin-display.ts";

describe("origin display mapping", () => {
  it.each(Object.entries(ORIGIN_DISPLAY))(
    "keeps the %s display label and colour palette",
    (origin, display) => {
      expect(originLabel(origin)).toBe(display.label);
      expect(originColorPalette(origin)).toBe(display.colorPalette);
    },
  );

  it("passes unknown origins through with a neutral palette", () => {
    expect(originLabel("mystery")).toBe("mystery");
    expect(originColorPalette("mystery")).toBe("gray");
  });

  describe("given the spec's badge color table", () => {
    /** @scenario Origin colors follow the centralized originColors mapping */
    it("derives each origin's subtle background and emphasized foreground from its color palette", () => {
      // Chakra semantic-token convention: a colorPalette token names its own
      // .subtle (background) and .emphasized (foreground) pair, so ORIGIN_DISPLAY
      // only needs to carry the palette name once per origin.
      const expected: Record<string, { background: string; foreground: string }> = {
        application: { background: "blue.subtle", foreground: "blue.emphasized" },
        evaluation: { background: "green.subtle", foreground: "green.emphasized" },
        simulation: { background: "pink.subtle", foreground: "pink.emphasized" },
        playground: { background: "teal.subtle", foreground: "teal.emphasized" },
        gateway: { background: "purple.subtle", foreground: "purple.emphasized" },
        workflow: { background: "cyan.subtle", foreground: "cyan.emphasized" },
      };

      for (const [origin, { background, foreground }] of Object.entries(expected)) {
        const palette = originColorPalette(origin);
        expect(`${palette}.subtle`).toBe(background);
        expect(`${palette}.emphasized`).toBe(foreground);
      }
    });
  });
});
