/**
 * The one chart palette and chart style set. Colours are design-system tokens, so light and
 * dark resolve in the host and widgets never carry their own copy. The token order matches
 * `rotatingColors.colors`, so series three is the same hue in every chart.
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
 * shim embeds it as source text, so it may not refer to anything outside its own body.
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
    series: seriesTokens.map((token) => colors[token] ?? ""),
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
  return {
    barCornerRadius: metrics.barCornerRadius,
    dotSize: metrics.dotSize,
    track: colors[styleTokens.track] ?? "",
    axis: colors[styleTokens.axis] ?? "",
    grid: colors[styleTokens.grid] ?? "",
  };
}
