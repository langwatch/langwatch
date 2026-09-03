import { describe, expect, it } from "vitest";
import {
  getColorForString,
  getColorPaletteForString,
  getHexColorForString,
  rotatingColors,
} from "../src/rotating-colors";

const NAMES = [
  "checkout-agent",
  "support-triage",
  "",
  "a",
  "Engineering",
  "engineering",
  "a very long workspace name that keeps going",
];

describe("rotatingColors", () => {
  describe("given the same name asked for twice", () => {
    it("returns the same token pair both times", () => {
      for (const name of NAMES) {
        expect(getColorForString("colors", name)).toEqual(getColorForString("colors", name));
      }
    });

    it("returns the same hue whichever of the three forms is asked for", () => {
      for (const name of NAMES) {
        const pair = getColorForString("colors", name);
        const palette = getColorPaletteForString(name);

        expect(pair.background).toBe(`${palette}.subtle`);
        expect(pair.color).toBe(`${palette}.emphasized`);
      }
    });

    it("paints charts in the hue the badge for that name already uses", () => {
      const paletteHexes = new Map(
        NAMES.map((name) => [getColorPaletteForString(name), getHexColorForString(name)]),
      );

      // One palette can never resolve to two different hexes, whichever name
      // hashed onto it.
      for (const name of NAMES) {
        expect(getHexColorForString(name)).toBe(paletteHexes.get(getColorPaletteForString(name)));
      }
      expect(new Set(paletteHexes.values()).size).toBe(paletteHexes.size);
    });
  });

  describe("given a spread of unrelated names", () => {
    it("spends the whole palette rather than crowding one hue", () => {
      const hues = new Set(
        Array.from({ length: 200 }, (_, index) => getColorPaletteForString(`workspace-${index}`)),
      );

      expect(hues.size).toBe(rotatingColors.colors.length);
    });
  });

  describe("given a set other than the default one", () => {
    it("draws only from that set", () => {
      const set = rotatingColors.positiveNegativeNeutral;
      for (const name of NAMES) {
        expect(set).toContainEqual(getColorForString("positiveNegativeNeutral", name));
      }
    });

    it("keeps the numeric chart tones out of the semantic token sets", () => {
      for (const tone of rotatingColors.orangeTones) {
        expect(rotatingColors.colors).not.toContainEqual(tone);
      }
    });
  });

  describe("given any name at all", () => {
    it("never runs off the end of a set", () => {
      for (const name of NAMES) {
        expect(rotatingColors.colors).toContainEqual(getColorForString("colors", name));
        expect(getHexColorForString(name)).toMatch(/^#[0-9a-f]{6}$/);
      }
    });
  });
});
