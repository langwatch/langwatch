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

/**
 * Axis labels. Recharts defaults tick text to a fixed `#666`, which is dim
 * against a dark panel and out of step with every other label on the page.
 */
export const CHART_AXIS_TICK = {
  fontSize: 11,
  fill: "var(--chakra-colors-fg-muted)",
} as const;

/**
 * Grid lines. Left unset, recharts draws them in `#ccc` — on a dark panel that
 * reads as bright dashes across the data.
 */
export const CHART_GRID_STROKE = "var(--chakra-colors-border)";

/**
 * The colour a single-series mark on a governance card draws in.
 *
 * Spelled as a CSS variable because recharts is handed raw SVG attributes and
 * cannot resolve a Chakra token name.
 *
 * This is the hue reserved for a series with no name to hash, so the small
 * chart on a card and the big one beside it are visibly the same kind of
 * object. It is not `fg-muted` (an ink token, and this shipped that way once)
 * and not the brand accent, which the pressable controls wear.
 *
 * It is NOT the same value as the chart palette's blue, and this comment said
 * it was until the two were measured in the browser: `blue.solid` is #3182ce
 * in both themes, `PALETTE_HEX.blue` is #3b82f6. Two blues, near enough to
 * read as one and far enough apart that no grep pairs them.
 *
 * The rules and the reasoning are in
 * specs/ai-governance/dashboard/governance-ui-controls.feature, "Colour on a
 * card" — the section rulebook rather than this file, so the next page adding
 * a card can read them. Bound by:
 *   "A single-series mark on a governance card is drawn from the chart palette"
 *   "A data mark does not borrow the brand accent reserved for controls"
 *   "A chart's marks are drawn in chart colours, never in text colours"
 */
export const CHART_SPARK_STROKE = "var(--chakra-colors-blue-solid)";

/**
 * The seats subject, in the one hue it speaks in.
 *
 * Seats are drawn twice on the Costs screen — as the assigned bars in the seat
 * chart, and as the per-pool meter inside the lane card — and the two were in
 * two different blues, neither of them the blue the sparklines above them use.
 * Three meanings, one colour, measured 1.09:1 and 1.28:1 apart. So seats moved
 * off blue entirely and both marks now name this.
 *
 * Teal because teal and cyan were the only palette hues not already carrying a
 * figure on that screen, and cyan is the nearer to blue. The pair below is the
 * contract and the reading: slate for the seats bought, which is an outline of
 * what is paid for, and teal for the seats somebody is sitting in. The unfilled
 * difference is then the idle spend, which is what the panel is on the screen
 * for.
 *
 * The slate is not a palette hue and is not meant to be. It is the same ink the
 * forecast draws its projection in, and it means the same thing in both places:
 * a quantity that is not a measurement of what happened.
 *
 * ONE SPELLING, for both. The recharts series needs a raw SVG attribute and the
 * meter is a Chakra Box, so this briefly existed twice — as a CSS variable here
 * and as `teal.solid` beside it. Chakra passes a raw CSS value through
 * untouched, so the variable serves both and the pair that could drift is gone.
 *
 * Rules in specs/ai-governance/dashboard/governance-ui-controls.feature,
 * "Colour on a card". Bound by:
 *   "Two marks that mean different things do not share a colour family"
 */
export const CHART_SEAT_FILL = "var(--chakra-colors-teal-solid)";

/**
 * Seats bought — the contract behind the meter, not a measurement.
 *
 * Named `..._FILL` deliberately, and this is worth knowing before adding a
 * constant beside it. The mark-colour guard finds a constant by its NAME, on a
 * suffix of stroke, fill or ink (`markColourScan.ts`), because a top-level
 * export is neither a JSX attribute nor a property assignment and there is
 * nothing else to recognise it by. This value was called `CHART_SEAT_CONTRACT`
 * for an hour, and in that hour setting it to `green.solid` passed the whole
 * suite — measured, not reasoned. A mark colour whose name the guard cannot
 * read is not guarded at all.
 */
export const CHART_SEAT_CONTRACT_FILL = "#94a3b8";
