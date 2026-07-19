/**
 * Centralized origin color and label configuration.
 *
 * Maps trace origin values to display colors, reusing the color scheme
 * from featureIcons.ts for visual consistency across the platform.
 *
 * "application" traces (no explicit origin) use the traces blue color,
 * while other origins match their corresponding feature colors.
 */

import { getColorForString } from "./rotatingColors";

/**
 * Known origin values mapped to their display colors.
 * Colors use the subtle/emphasized pattern for badge rendering.
 */
export const originColors: Record<
  string,
  { background: string; color: string }
> = {
  application: { background: "blue.subtle", color: "blue.emphasized" },
  evaluation: { background: "green.subtle", color: "green.emphasized" },
  simulation: { background: "pink.subtle", color: "pink.emphasized" },
  playground: { background: "teal.subtle", color: "teal.emphasized" },
  gateway: { background: "purple.subtle", color: "purple.emphasized" },
  workflow: { background: "cyan.subtle", color: "cyan.emphasized" },
  sample: { background: "gray.subtle", color: "gray.emphasized" },
  coding_agent: { background: "orange.subtle", color: "orange.emphasized" },
  ai_tool: { background: "yellow.subtle", color: "yellow.emphasized" },
};

/**
 * Human-readable labels for multi-word / underscore origin values that a
 * naive capitalize-first would mangle ("coding_agent" -> "Coding_agent").
 * Single-word origins fall through to {@link getOriginLabel}'s capitalize.
 */
const ORIGIN_LABELS: Record<string, string> = {
  coding_agent: "Coding Agent",
  ai_tool: "AI Tool",
};

/**
 * Returns the display color for a given origin value.
 * Known origins use their designated colors; unknown origins
 * fall back to a hash-based color from the rotating palette.
 */
export function getOriginColor(origin: string): {
  background: string;
  color: string;
} {
  return originColors[origin] ?? getColorForString("colors", origin);
}

/**
 * Returns a human-readable label for an origin value.
 * Capitalizes the first letter: "evaluation" -> "Evaluation".
 */
export function getOriginLabel(origin: string): string {
  if (!origin) return "";
  return ORIGIN_LABELS[origin] ?? origin.charAt(0).toUpperCase() + origin.slice(1);
}
