import { system } from "@langwatch/design-system/system";
/**
 * The colour of a target in a comparison.
 * @see specs/features/agent-testing/comparison-mode.feature
 */

export const TARGET_COLORS = [
  system.token.var("colors.chart.2"),
  system.token.var("colors.chart.1"),
  system.token.var("colors.chart.3"),
  system.token.var("colors.chart.8"),
  system.token.var("colors.chart.5"),
  system.token.var("colors.red.solid"),
  system.token.var("colors.chart.6"),
  system.token.var("colors.chart.4"),
] as const;

/** The colour of the target at this position; the palette wraps after eight. */
export function targetColor(index: number): string {
  return TARGET_COLORS[index % TARGET_COLORS.length] ?? TARGET_COLORS[0];
}
