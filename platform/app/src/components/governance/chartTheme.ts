/**
 * Shared recharts styling for the governance charts.
 *
 * Recharts draws its tooltip on a hard-coded white background with a hard-coded
 * light border. Passing only `fontSize` leaves both in place, so in dark mode
 * every chart on the page opened a white card, and the date heading inside it —
 * also hard-coded dark — vanished into it. These map the tooltip onto the same
 * Chakra tokens as the panel around it, so it follows the theme like everything
 * else on the screen.
 */

/** The tooltip card: panel background, real border, readable at either theme. */
export const CHART_TOOLTIP_CONTENT = {
  background: "var(--chakra-colors-bg-panel)",
  border: "1px solid var(--chakra-colors-border)",
  borderRadius: 6,
  fontSize: 12,
} as const;

/**
 * The heading inside the card — the day, or the series name. Recharts defaults
 * it to near-black, which is the half of the tooltip that disappeared.
 */
export const CHART_TOOLTIP_LABEL = {
  color: "var(--chakra-colors-fg)",
  fontWeight: 600,
  marginBottom: 4,
} as const;

/** The band drawn behind the hovered category. Chakra's muted, not grey #ccc. */
export const CHART_TOOLTIP_CURSOR = {
  fill: "var(--chakra-colors-bg-muted)",
} as const;
