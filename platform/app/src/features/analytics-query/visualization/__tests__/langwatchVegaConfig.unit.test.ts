/**
 * The chart's appearance, as a function of resolved theme values.
 *
 * The assertions are that every colour, font and size in the configuration
 * came from the tokens handed in — not from a literal written here — because a
 * literal is exactly how a chart drifts away from the application around it.
 * Which tokens the application resolves is the component layer's business and
 * is covered where that resolving happens.
 *
 * Node environment on purpose: this module has to stay free of React, the DOM
 * and Chakra, and a test that could not run without them would not prove it.
 */
import { describe, expect, it } from "vitest";

import {
  type LangWatchQLVegaColorMode,
  type LangwatchVegaTokens,
  langwatchVegaConfig,
  langwatchVegaPinnedConfig,
} from "../langwatchVegaConfig";

const LIGHT_TOKENS: LangwatchVegaTokens = {
  fontFamily: "Inter, sans-serif",
  labelFontSize: 11,
  titleFontSize: 12,
  textColor: "#2d2d3d",
  mutedTextColor: "#5c5c6e",
  gridColor: "#e2e8f0",
  domainColor: "#cbd5e1",
  categoricalRange: ["#ED8926", "#3182ce", "#38A169"],
};

const DARK_TOKENS: LangwatchVegaTokens = {
  ...LIGHT_TOKENS,
  textColor: "#e2e8f0",
  mutedTextColor: "#9CA3AF",
  gridColor: "#2d2d3d",
  domainColor: "#3d3d4d",
  categoricalRange: ["#FF9E2C", "#63b3ed", "#68D391"],
};

/** Every string leaf of the configuration, for "did any token reach here". */
const stringLeaves = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(stringLeaves);
  }
  return [];
};

const configFor = (colorMode: LangWatchQLVegaColorMode) =>
  langwatchVegaConfig({
    colorMode,
    tokens: colorMode === "dark" ? DARK_TOKENS : LIGHT_TOKENS,
  });

describe("the LangWatch Vega configuration", () => {
  describe("given resolved theme tokens", () => {
    describe("when a configuration is built for light and for dark", () => {
      /** @scenario "The chart follows LangWatch theming in light and dark modes" */
      it("takes every font, colour and size from the tokens it was given", () => {
        for (const colorMode of ["light", "dark"] as const) {
          const tokens = colorMode === "dark" ? DARK_TOKENS : LIGHT_TOKENS;
          const config = configFor(colorMode) as Record<string, any>;

          expect(config.font, colorMode).toBe(tokens.fontFamily);
          expect(config.axis.labelFont, colorMode).toBe(tokens.fontFamily);
          expect(config.axis.labelColor, colorMode).toBe(tokens.mutedTextColor);
          expect(config.axis.titleColor, colorMode).toBe(tokens.textColor);
          expect(config.axis.gridColor, colorMode).toBe(tokens.gridColor);
          expect(config.axis.domainColor, colorMode).toBe(tokens.domainColor);
          expect(config.axis.labelFontSize, colorMode).toBe(
            tokens.labelFontSize,
          );
          expect(config.legend.labelColor, colorMode).toBe(tokens.textColor);
          expect(config.legend.labelFont, colorMode).toBe(tokens.fontFamily);
          expect(config.header.labelFont, colorMode).toBe(tokens.fontFamily);
          expect(config.title.font, colorMode).toBe(tokens.fontFamily);
          expect(config.title.color, colorMode).toBe(tokens.textColor);
          expect(config.range.category, colorMode).toEqual([
            ...tokens.categoricalRange,
          ]);
          expect(config.range.ordinal, colorMode).toEqual([
            ...tokens.categoricalRange,
          ]);
          expect(config.mark.color, colorMode).toBe(tokens.categoricalRange[0]);
        }
      });

      it("draws on the card rather than over it, and adds no border of its own", () => {
        for (const colorMode of ["light", "dark"] as const) {
          const config = configFor(colorMode) as Record<string, any>;
          expect(config.background, colorMode).toBe("transparent");
          expect(config.view.stroke, colorMode).toBeNull();
        }
      });

      /** @scenario "The chart follows LangWatch theming in light and dark modes" */
      it("reads differently in each mode rather than sharing one palette", () => {
        const light = configFor("light") as Record<string, any>;
        const dark = configFor("dark") as Record<string, any>;

        expect(dark.axis.labelColor).not.toBe(light.axis.labelColor);
        expect(dark.range.category).not.toEqual(light.range.category);
        // A ramp has to run away from the surface it sits on, so the two modes
        // cannot share a sequential scheme even when every token is the same.
        expect(dark.range.ramp).not.toBe(light.range.ramp);
        expect(typeof light.range.heatmap).toBe("string");
      });

      it("carries no colour that did not come from a token", () => {
        const tokenValues = new Set<string>([
          LIGHT_TOKENS.fontFamily,
          LIGHT_TOKENS.textColor,
          LIGHT_TOKENS.mutedTextColor,
          LIGHT_TOKENS.gridColor,
          LIGHT_TOKENS.domainColor,
          ...LIGHT_TOKENS.categoricalRange,
        ]);

        const strays = stringLeaves(configFor("light")).filter(
          (leaf) => /^#|^rgb/.test(leaf) && !tokenValues.has(leaf),
        );

        expect(strays).toEqual([]);
      });

      it("is a pure function of its inputs", () => {
        const tokens: LangwatchVegaTokens = {
          ...LIGHT_TOKENS,
          categoricalRange: [...LIGHT_TOKENS.categoricalRange],
        };
        const before = JSON.stringify(tokens);

        const first = langwatchVegaConfig({ colorMode: "light", tokens });
        const second = langwatchVegaConfig({ colorMode: "light", tokens });

        expect(first).toEqual(second);
        expect(first).not.toBe(second);
        expect(JSON.stringify(tokens)).toBe(before);
      });
    });

    describe("when the pinned overrides are built", () => {
      it("pins the background and the font, and nothing that is a style choice", () => {
        const pinned = langwatchVegaPinnedConfig({
          tokens: LIGHT_TOKENS,
        }) as Record<string, any>;

        expect(pinned.background).toBe("transparent");
        expect(pinned.font).toBe(LIGHT_TOKENS.fontFamily);
        expect(pinned.axis.titleFont).toBe(LIGHT_TOKENS.fontFamily);
        expect(pinned.legend.labelFont).toBe(LIGHT_TOKENS.fontFamily);

        // Colours, sizes and marks stay out: a member may restyle those.
        expect(pinned.axis.labelColor).toBeUndefined();
        expect(pinned.range).toBeUndefined();
        expect(pinned.mark).toBeUndefined();
      });
    });
  });
});
