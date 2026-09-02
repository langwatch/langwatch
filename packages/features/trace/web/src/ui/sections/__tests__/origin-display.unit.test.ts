import { describe, expect, it } from "vitest";
import { ORIGIN_DISPLAY, originColorPalette, originLabel } from "../../../index";

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
});
