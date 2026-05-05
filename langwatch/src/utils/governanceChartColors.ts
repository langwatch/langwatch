/**
 * Stable color hash for chart series + table avatars on the
 * governance bird's-eye dashboard. Mirrors the algorithm used by
 * `getColorForString("colors", name)` (rotatingColors.ts) — same
 * sum-of-char-codes mod palette-length — but returns actual hex
 * strings instead of Chakra tokens so the values are usable in
 * Recharts SVG `fill` / `stroke` props. Result: a team named
 * "Customer Support" gets the same hue across its row avatar, the
 * stacked-area chart, the model breakdown bar, and the legend.
 *
 * Palette tracks `rotatingColors.colors` (orange/blue/green/yellow/
 * purple/teal/cyan/pink) so the visual identity stays consistent
 * with /messages, /traces, /presence, etc. Hex values are picked
 * from Chakra v3 default scales (e.g. `orange.500 = #f97316`) —
 * mid-saturation tones that work as both stroke and fill at 35%
 * opacity.
 */

const CHART_PALETTE = [
  "#f97316", // orange.500
  "#3b82f6", // blue.500
  "#22c55e", // green.500
  "#eab308", // yellow.500
  "#a855f7", // purple.500
  "#14b8a6", // teal.500
  "#06b6d4", // cyan.500
  "#ec4899", // pink.500
] as const;

const cache = new Map<string, string>();

/**
 * Hash a string to a stable hex color from the chart palette.
 * Same name → same color across renders, sessions, and components.
 */
export function getChartColorForName(name: string): string {
  const cached = cache.get(name);
  if (cached) return cached;
  let sum = 0;
  for (let i = 0; i < name.length; i++) {
    sum += name.charCodeAt(i);
  }
  const color = CHART_PALETTE[sum % CHART_PALETTE.length]!;
  cache.set(name, color);
  return color;
}
