/**
 * The one place a pass rate becomes a colour on the Agent Testing surface.
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { SCENARIO_RUN_STATUS_CONFIG } from "../../../../model/scenario-run-status-config";
import { ScenarioRunStatus } from "@langwatch/scenario-contract";

/** Where amber starts. Under this a pass rate reads red. */
export const PASS_RATE_AMBER_FLOOR = 40;

/**
 * Where green starts.
 */
export const PASS_RATE_GREEN_FLOOR = 99.5;

/** The bands a pass rate can fall in, once thresholds are applied. */
export type PassRateBand = "green" | "amber" | "red" | "none";

/** The orange of the theme, the one colour of the three no run status reads. */
export const PASS_RATE_AMBER_COLOR = "orange.500";

const BAND_COLORS: Record<PassRateBand, string> = {
  green: SCENARIO_RUN_STATUS_CONFIG[ScenarioRunStatus.SUCCESS].fgColor,
  amber: PASS_RATE_AMBER_COLOR,
  red: SCENARIO_RUN_STATUS_CONFIG[ScenarioRunStatus.FAILED].fgColor,
  none: "fg.subtle",
};

/**
 * Which band a pass rate falls in. Exported so a caller that needs the band itself, for
 * a label or a test, reads the same thresholds as the colour.
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
 */
export const PASS_RATE_BAR_OPACITY = 0.8;

/**
 * The percentage a pass rate reads as, or a dash when nothing settled.
 */
export function formatPassRate(passRate: number | null): string {
  if (passRate === null || Number.isNaN(passRate)) return "-";
  return `${Math.round(passRate)}%`;
}
