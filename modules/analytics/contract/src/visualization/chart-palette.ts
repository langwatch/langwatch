/**
 * One chart palette and style set, from design-system tokens resolved by the host. Widget code
 * (`LW.palette`, `LW.chartStyle`) and the bundled charts read the same values. Order matches
 * `rotatingColors.colors`.
 */

/** Ordered series tokens; the host resolves each for the current colour mode. */
export const CHART_SERIES_TOKENS = [
  "chart.1",
  "chart.2",
  "chart.3",
  "chart.4",
  "chart.5",
  "chart.6",
  "chart.7",
  "chart.8",
] as const;

/** Greys a chart draws with: the track behind a bar, the axis labels, and the gridlines. */
export const CHART_STYLE_TOKENS = {
  track: "bg.muted",
  axis: "fg.subtle",
  grid: "border.muted",
} as const;

/** Shape metrics a chart reads; a value here changes every chart, so keep it deliberate. */
export const CHART_STYLE_METRICS = {
  barCornerRadius: 4,
  dotSize: 6,
} as const;

export type ChartColorMode = "light" | "dark";

/** `LW.palette` in widget code: the ordered series colours for the current mode. */
export interface ChartPalette {
  readonly mode: ChartColorMode;
  readonly series: readonly string[];
}

/** `LW.chartStyle` in widget code: shape metrics plus the greys, for the current mode. */
export interface ChartStyle {
  readonly barCornerRadius: number;
  readonly dotSize: number;
  readonly track: string;
  readonly axis: string;
  readonly grid: string;
}

/**
 * Resolves the series colours from the host's token map. Pure and self-contained: the frame
 * shim embeds it as source text, so it may not refer to anything outside its own body. A token
 * the host did not resolve throws, as `token()` does in the bundled charts.
 */
export function chartPaletteOf({
  colors,
  mode,
  seriesTokens,
}: {
  colors: Readonly<Record<string, string>>;
  mode: ChartColorMode;
  seriesTokens: readonly string[];
}): ChartPalette {
  return {
    mode: mode === "dark" ? "dark" : "light",
    series: seriesTokens.map((token) => {
      const value = colors[token];
      if (!value) throw new Error(`Missing chart colour token: ${token}`);
      return value;
    }),
  };
}

/** Resolves the style set from the host's token map; same embedding rule as `chartPaletteOf`. */
export function chartStyleOf({
  colors,
  styleTokens,
  metrics,
}: {
  colors: Readonly<Record<string, string>>;
  styleTokens: { readonly track: string; readonly axis: string; readonly grid: string };
  metrics: { readonly barCornerRadius: number; readonly dotSize: number };
}): ChartStyle {
  const resolve = (token: string): string => {
    const value = colors[token];
    if (!value) throw new Error(`Missing chart colour token: ${token}`);
    return value;
  };
  return {
    barCornerRadius: metrics.barCornerRadius,
    dotSize: metrics.dotSize,
    track: resolve(styleTokens.track),
    axis: resolve(styleTokens.axis),
    grid: resolve(styleTokens.grid),
  };
}
