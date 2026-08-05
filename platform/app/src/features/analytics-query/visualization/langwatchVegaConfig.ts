/**
 * The LangWatch Vega configuration: what a governed chart looks like.
 *
 * A pure function over *resolved* values. It imports no Chakra and reads no
 * DOM, because everything under `visualization/` has to stay server-import-safe
 * — the component layer resolves the theme tokens and hands the answers in.
 *
 * Precedence is deliberate, and `buildGovernedVegaSpec` is what enforces it:
 *
 *   this config  <  the member's own `config`  <  the pinned overrides
 *
 * So a member can restyle an axis or a mark, and cannot change the background
 * the chart is drawn on or the font it is drawn in — the two that decide
 * whether a chart reads as part of the application or as something pasted into
 * it, and the two a screenshot of a governed result is judged on.
 */

/** Which of the application's two modes the chart is being drawn in. */
export type GovernedVegaColorMode = "light" | "dark";

/**
 * The theme values a chart needs, already resolved to literals.
 *
 * Chakra tokens are resolved by the component layer (`useLangwatchVegaTokens`)
 * and handed in, so this module stays a pure function of its inputs and the
 * whole of the chart's appearance can be asserted without rendering anything.
 */
export interface LangwatchVegaTokens {
  readonly fontFamily: string;
  readonly labelFontSize: number;
  readonly titleFontSize: number;
  /** Foreground for titles and legend labels. */
  readonly textColor: string;
  /** Foreground for axis labels and other secondary text. */
  readonly mutedTextColor: string;
  /** Gridlines inside the plotting area. */
  readonly gridColor: string;
  /** Axis domain lines and ticks. */
  readonly domainColor: string;
  /**
   * The categorical series colours, in the application's own chart order, so a
   * governed chart's third series is the colour every other chart gives its
   * third series.
   */
  readonly categoricalRange: readonly string[];
}

/**
 * A Vega configuration object. Typed as an opaque record rather than Vega's own
 * `Config`: importing that type would pull the Vega runtime into the policy
 * modules, which is exactly what they are kept free of.
 */
export type GovernedVegaConfig = Readonly<Record<string, unknown>>;

/**
 * Sequential and diverging schemes, which are the one part of the palette that
 * cannot be resolved from a token: a ramp has to run *away* from the surface it
 * is drawn on, so light and dark need schemes with opposite luminance
 * direction rather than the same scheme in two colours.
 */
const CONTINUOUS_SCHEMES: Record<
  GovernedVegaColorMode,
  { heatmap: string; ramp: string; diverging: string }
> = {
  light: { heatmap: "blues", ramp: "blues", diverging: "blueorange" },
  dark: { heatmap: "viridis", ramp: "viridis", diverging: "blueorange" },
};

/**
 * The values a member's own `config` can never override.
 *
 * Kept separate from the rest so the merge in `buildGovernedVegaSpec` has one
 * obvious "and these win" step rather than a hand-audited diff of two large
 * objects.
 */
export function langwatchVegaPinnedConfig({
  tokens,
}: {
  tokens: LangwatchVegaTokens;
}): GovernedVegaConfig {
  return {
    // The chart sits on a card that already has a background. An opaque chart
    // background would paint a rectangle over it in whichever mode disagreed.
    background: "transparent",
    font: tokens.fontFamily,
    axis: { labelFont: tokens.fontFamily, titleFont: tokens.fontFamily },
    legend: { labelFont: tokens.fontFamily, titleFont: tokens.fontFamily },
    header: { labelFont: tokens.fontFamily, titleFont: tokens.fontFamily },
    title: { font: tokens.fontFamily, subtitleFont: tokens.fontFamily },
    text: { font: tokens.fontFamily },
  };
}

/**
 * The full LangWatch look: fonts, axes, gridlines, legends, titles, and the
 * categorical range every series is coloured from.
 */
export function langwatchVegaConfig({
  colorMode,
  tokens,
}: {
  colorMode: GovernedVegaColorMode;
  tokens: LangwatchVegaTokens;
}): GovernedVegaConfig {
  return {
    background: "transparent",
    font: tokens.fontFamily,
    padding: 8,
    // The card already draws the border; a second one inside it reads as a bug.
    view: { stroke: null, continuousWidth: 320, continuousHeight: 200 },
    axis: {
      labelFont: tokens.fontFamily,
      labelFontSize: tokens.labelFontSize,
      labelColor: tokens.mutedTextColor,
      titleFont: tokens.fontFamily,
      titleFontSize: tokens.titleFontSize,
      titleColor: tokens.textColor,
      titleFontWeight: 500,
      titlePadding: 8,
      domainColor: tokens.domainColor,
      tickColor: tokens.domainColor,
      gridColor: tokens.gridColor,
      gridOpacity: 1,
      labelPadding: 4,
      labelOverlap: "greedy",
    },
    axisY: { grid: true, domain: false, ticks: false },
    axisX: { grid: false },
    legend: {
      labelFont: tokens.fontFamily,
      labelFontSize: tokens.labelFontSize,
      labelColor: tokens.textColor,
      titleFont: tokens.fontFamily,
      titleFontSize: tokens.labelFontSize,
      titleColor: tokens.mutedTextColor,
      titleFontWeight: 500,
      symbolType: "circle",
      symbolSize: 80,
      orient: "right",
      offset: 12,
    },
    header: {
      labelFont: tokens.fontFamily,
      labelFontSize: tokens.labelFontSize,
      labelColor: tokens.mutedTextColor,
      titleFont: tokens.fontFamily,
      titleFontSize: tokens.titleFontSize,
      titleColor: tokens.textColor,
    },
    title: {
      font: tokens.fontFamily,
      fontSize: tokens.titleFontSize,
      color: tokens.textColor,
      subtitleFont: tokens.fontFamily,
      subtitleColor: tokens.mutedTextColor,
      anchor: "start",
      offset: 12,
    },
    text: { font: tokens.fontFamily, fill: tokens.textColor },
    range: {
      category: [...tokens.categoricalRange],
      ordinal: [...tokens.categoricalRange],
      ...CONTINUOUS_SCHEMES[colorMode],
    },
    mark: { color: tokens.categoricalRange[0] ?? tokens.textColor },
    line: { strokeWidth: 2 },
    point: { filled: true, size: 40 },
  };
}
