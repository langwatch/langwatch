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

import type {
  LangWatchQLVegaColorMode,
  LangwatchVegaTokens,
} from "@langwatch/analytics-contract/visualization";
import { getRawColorValue, useColorMode } from "@langwatch/design-system/color-mode";
import { useToken } from "@langwatch/design-system/primitives";
import { rotatingColors } from "@langwatch/design-system/rotating-colors";
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
        mutedTextColor: getRawColorValue("fg.subtle"),
        gridColor: getRawColorValue("border.muted"),
        domainColor: getRawColorValue("border.card"),
        categoricalRange: rotatingColors.colors.map((_, index) =>
          getRawColorValue(`chart.${index + 1}`),
        ),
      },
    };
  }, [colorMode, bodyFont]);
}
