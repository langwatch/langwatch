/**
 * Resolving the app's theme into the literals a chart needs — the only
 * place Chakra and the chart meet, since `langwatchVegaConfig` stays pure
 * so `visualization/` never pulls Chakra into a server import.
 */

/**
 * The categorical range and greys come from the shared chart palette and style set, so a
 * LangWatchQL chart matches the tokens widget code reads through `LW.palette` and `LW.chartStyle`.
 */

import {
  CHART_SERIES_TOKENS,
  CHART_STYLE_TOKENS,
  type LangWatchQLVegaColorMode,
  type LangwatchVegaTokens,
} from "@langwatch/analytics-contract/visualization";
import { getRawColorValue, useColorMode } from "@langwatch/design-system/color-mode";
import { useToken } from "@langwatch/design-system/primitives";
import { useMemo } from "react";

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
    return {
      colorMode,
      tokens: {
        fontFamily: bodyFont ?? "Inter, sans-serif",
        labelFontSize: 11,
        titleFontSize: 12,
        textColor: getRawColorValue("fg"),
        mutedTextColor: getRawColorValue(CHART_STYLE_TOKENS.axis),
        gridColor: getRawColorValue(CHART_STYLE_TOKENS.grid),
        domainColor: getRawColorValue("border.card"),
        categoricalRange: CHART_SERIES_TOKENS.map((token) => getRawColorValue(token)),
      },
    };
  }, [colorMode, bodyFont]);
}
