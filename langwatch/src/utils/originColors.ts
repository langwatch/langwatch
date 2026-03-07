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
  evaluation: { background: "orange.subtle", color: "orange.emphasized" },
  simulation: { background: "pink.subtle", color: "pink.emphasized" },
  playground: { background: "purple.subtle", color: "purple.emphasized" },
  workflow: { background: "green.subtle", color: "green.emphasized" },
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
  return origin.charAt(0).toUpperCase() + origin.slice(1);
}
