/**
 * Resolving the app's theme into the literals a chart needs — the only
 * place Chakra and the chart meet, since `langwatchVegaConfig` stays pure
 * so `visualization/` never pulls Chakra into a server import.
 */

/**
 * The categorical range is the app's own chart palette, in its own order:
 * `rotatingColors.colors` is what `CustomGraph` colors series from, so a
 * series third here matches the color a series third elsewhere already has.
 */

import { useToken } from "@chakra-ui/react";
import { useMemo } from "react";

import { getRawColorValue, useColorMode } from "@langwatch/design-system/color-mode";
import { rotatingColors } from "@langwatch/design-system/rotating-colors";

import type {
  LangWatchQLVegaColorMode,
  LangwatchVegaTokens,
} from "@langwatch/analytics-contract/visualization";

/**
 * The palette names behind the application's chart colours, derived from the
 * same exported constant `getColorPaletteForString` derives them from, so
 * reordering that list reorders this one too.
 */
const CHART_PALETTES = rotatingColors.colors.map(
  (entry) => entry.background.split(".")[0] ?? "gray",
);

/**
 * Tone per mode. A mid-saturation hue reads on white; the same hue is too dark
 * on a near-black card, so dark mode moves two steps lighter.
 */
const SERIES_TONE: Record<LangWatchQLVegaColorMode, number> = {
  light: 500,
  dark: 300,
};

const TEXT_TOKENS: Record<
  LangWatchQLVegaColorMode,
  { text: string; muted: string; grid: string; domain: string }
> = {
  light: {
    text: "gray.700",
    muted: "gray.500",
    grid: "gray.200",
    domain: "gray.300",
  },
  dark: {
    text: "gray.200",
    muted: "gray.400",
    grid: "gray.700",
    domain: "gray.600",
  },
};

export interface LangwatchVegaTheme {
  readonly colorMode: LangWatchQLVegaColorMode;
  readonly tokens: LangwatchVegaTokens;
}

export function useLangwatchVegaTokens(): LangwatchVegaTheme {
  const { colorMode: raw } = useColorMode();
  const [bodyFont] = useToken("fonts", "body");
  // `useColorMode` reports the *resolved* theme, which is undefined for the
  // first paint before next-themes has read the preference.
  const colorMode: LangWatchQLVegaColorMode = raw === "dark" ? "dark" : "light";

  return useMemo(() => {
    const palette = TEXT_TOKENS[colorMode];
    return {
      colorMode,
      tokens: {
        fontFamily: bodyFont ?? "Inter, sans-serif",
        labelFontSize: 11,
        titleFontSize: 12,
        textColor: getRawColorValue(palette.text),
        mutedTextColor: getRawColorValue(palette.muted),
        gridColor: getRawColorValue(palette.grid),
        domainColor: getRawColorValue(palette.domain),
        categoricalRange: CHART_PALETTES.map((name) =>
          getRawColorValue(`${name}.${SERIES_TONE[colorMode]}`),
        ),
      },
    };
  }, [colorMode, bodyFont]);
}
