/**
 * Resolving the application's theme into the literals a chart needs.
 *
 * This is the only place Chakra and the chart meet. `langwatchVegaConfig` is a
 * pure function of resolved values precisely so it can stay under
 * `visualization/`, which no server import may drag React or Chakra into — so
 * the resolving happens here, in the component layer, where a provider exists.
 *
 * The categorical range is the application's own chart palette, in the
 * application's own order: `rotatingColors.colors` is what `CustomGraph` colours
 * its series from, so a series that is third in a governed chart is the colour a
 * series that is third anywhere else already has.
 */

import { useToken } from "@chakra-ui/react";
import { useMemo } from "react";

import { getRawColorValue, useColorMode } from "~/components/ui/color-mode";
import { rotatingColors } from "~/utils/rotatingColors";

import type {
  GovernedVegaColorMode,
  LangwatchVegaTokens,
} from "../visualization/langwatchVegaConfig";

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
const SERIES_TONE: Record<GovernedVegaColorMode, number> = {
  light: 500,
  dark: 300,
};

const TEXT_TOKENS: Record<
  GovernedVegaColorMode,
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
  readonly colorMode: GovernedVegaColorMode;
  readonly tokens: LangwatchVegaTokens;
}

export function useLangwatchVegaTokens(): LangwatchVegaTheme {
  const { colorMode: raw } = useColorMode();
  const [bodyFont] = useToken("fonts", "body");
  // `useColorMode` reports the *resolved* theme, which is undefined for the
  // first paint before next-themes has read the preference.
  const colorMode: GovernedVegaColorMode = raw === "dark" ? "dark" : "light";

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
