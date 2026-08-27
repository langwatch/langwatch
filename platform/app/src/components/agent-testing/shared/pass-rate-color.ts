/**
 * The one place a pass rate becomes a colour on the Agent Testing surface.
 *
 * Thresholds and colours live together here on purpose. When a threshold
 * scale and a palette are defined apart, they drift: a 95 percent run once
 * read amber as text and green as a bar in the same row, because the text and
 * the bar each carried their own idea of where green starts. Text colour and
 * bar fill both call {@link passRateColor}, so one rate can only ever have one
 * colour.
 *
 * The bands:
 *
 * - green at 100 percent only. A plan with one failing scenario is not green.
 * - amber from 40 percent up to, but not including, 100.
 * - red below 40 percent.
 * - grey when nothing settled, so there is no rate to colour.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

/** Where amber starts. Under this a pass rate reads red. */
export const PASS_RATE_AMBER_FLOOR = 40;

/**
 * Where green starts.
 *
 * Just under 100 rather than exactly 100, so the colour agrees with the number
 * beside it: a rate is drawn rounded, and a rate of 99.97 that reads "100%" in
 * text would otherwise read amber. Anything that rounds to 99 percent or less
 * still reads amber, which is the rule the design asks for.
 */
export const PASS_RATE_GREEN_FLOOR = 99.5;

/** The bands a pass rate can fall in, once thresholds are applied. */
export type PassRateBand = "green" | "amber" | "red" | "none";

const BAND_COLORS: Record<PassRateBand, string> = {
  green: "green.fg",
  amber: "orange.fg",
  red: "red.fg",
  none: "fg.subtle",
};

/**
 * Which band a pass rate falls in. Exported so a caller that needs the band
 * itself, for a label or a test, reads the same thresholds as the colour.
 *
 * @param passRate 0 to 100, or null when nothing settled.
 */
export function passRateBand(passRate: number | null): PassRateBand {
  if (passRate === null || Number.isNaN(passRate)) return "none";
  if (passRate >= PASS_RATE_GREEN_FLOOR) return "green";
  if (passRate >= PASS_RATE_AMBER_FLOOR) return "amber";
  return "red";
}

/**
 * The colour a pass rate reads in, as a theme token. Serves the percentage
 * text and the fill of a trend bar alike.
 */
export function passRateColor(passRate: number | null): string {
  return BAND_COLORS[passRateBand(passRate)];
}

/**
 * How much softer than the text a drawn sparkline is.
 *
 * It softens the whole row of bars at once rather than each bar on its own, so
 * two bars can never end up at two opacities and read as two meanings. The
 * bars are a glance at history; the percentage beside them is the headline and
 * stays at full strength.
 */
export const PASS_RATE_BAR_OPACITY = 0.8;

/**
 * The percentage a pass rate reads as, or a dash when nothing settled.
 */
export function formatPassRate(passRate: number | null): string {
  if (passRate === null || Number.isNaN(passRate)) return "-";
  return `${Math.round(passRate)}%`;
}
