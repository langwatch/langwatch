import { describe, expect, it } from "vitest";

import {
  CHART_SERIES_TOKENS,
  CHART_STYLE_METRICS,
  CHART_STYLE_TOKENS,
  chartPaletteOf,
  chartStyleOf,
} from "../chart-palette.ts";

const lightColors = Object.fromEntries(
  CHART_SERIES_TOKENS.map((token, index) => [token, `#light${index + 1}`]),
);
const darkColors = Object.fromEntries(
  CHART_SERIES_TOKENS.map((token, index) => [token, `#dark${index + 1}`]),
);

describe("chartPaletteOf", () => {
  describe("given the host resolved the series tokens for light mode", () => {
    /** @scenario "Light mode gives the ordered series colours of the light tokens" */
    it("returns mode light with the eight series colours in token order", () => {
      const palette = chartPaletteOf({
        colors: lightColors,
        mode: "light",
        seriesTokens: CHART_SERIES_TOKENS,
      });

      expect(palette.mode).toBe("light");
      expect(palette.series).toEqual(Array.from({ length: 8 }, (_, index) => `#light${index + 1}`));
    });
  });

  describe("given the host resolved the series tokens for dark mode", () => {
    /** @scenario "Dark mode gives the dark series colours, not the light ones" */
    it("returns mode dark with the dark value of each series", () => {
      const palette = chartPaletteOf({
        colors: darkColors,
        mode: "dark",
        seriesTokens: CHART_SERIES_TOKENS,
      });

      expect(palette.mode).toBe("dark");
      expect(palette.series[0]).toBe("#dark1");
      expect(palette.series[7]).toBe("#dark8");
    });
  });

  describe("given a token the host did not resolve", () => {
    it("throws naming the missing token rather than returning an empty colour", () => {
      expect(() =>
        chartPaletteOf({
          colors: { "chart.1": "#only" },
          mode: "light",
          seriesTokens: ["chart.1", "chart.2"],
        }),
      ).toThrow("Missing chart colour token: chart.2");
    });
  });
});

describe("chartStyleOf", () => {
  describe("given a style token the host did not resolve", () => {
    it("throws naming the missing token", () => {
      expect(() =>
        chartStyleOf({
          colors: { "bg.muted": "#track", "fg.subtle": "#axis" },
          styleTokens: CHART_STYLE_TOKENS,
          metrics: CHART_STYLE_METRICS,
        }),
      ).toThrow("Missing chart colour token: border.muted");
    });
  });

  describe("given the host resolved the style tokens", () => {
    /** @scenario "The style set carries the shape metrics and the track, axis and grid greys" */
    it("carries the shape metrics and the track, axis and grid colours", () => {
      const style = chartStyleOf({
        colors: { "bg.muted": "#track", "fg.subtle": "#axis", "border.muted": "#grid" },
        styleTokens: CHART_STYLE_TOKENS,
        metrics: CHART_STYLE_METRICS,
      });

      expect(style).toEqual({
        barCornerRadius: CHART_STYLE_METRICS.barCornerRadius,
        dotSize: CHART_STYLE_METRICS.dotSize,
        track: "#track",
        axis: "#axis",
        grid: "#grid",
      });
    });
  });
});
