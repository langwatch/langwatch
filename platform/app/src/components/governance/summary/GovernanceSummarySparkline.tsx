import { Box } from "@chakra-ui/react";

/**
 * The shape of a series, at a glance, with no axes and no numbers.
 *
 * WHY THIS IS NOT THE COST SPARKLINE. The section already has one
 * (`LaneSparkline`, in governance/costs/CostCharts.tsx) and it was the first
 * thing looked at. It cannot be reused here: its tooltip formats every value
 * as money and labels it "Spend", so hovering a fleet-size line would tell the
 * reader they had spent fourteen dollars on fourteen agents. It also names its
 * gradient with a fixed element id, which stops being unique the moment two of
 * them share a page. Rather than widen a cost chart into a general one — and
 * pull recharts onto three pages that currently draw no chart at all — this
 * draws the one thing a summary card needs, as a polyline.
 *
 * THE COLOUR IS A CHART COLOUR, and the first draft of this file got that
 * wrong in the exact way the section rulebook names. It painted the line
 * `fg.subtle` to keep it quiet. `fg.*` is a token for READING TEXT: at light
 * theme it resolves near black, which is how the governance sparklines and
 * seat bars once came out as black marks on grey — a monochrome dashboard
 * inside a product that has a colour. The default here is `blue.solid`,
 * which is what the rulebook gives a single-series mark that has no name to
 * hash into the chart palette, so this line and an area chart under it read
 * as the same kind of object.
 *
 * QUIET IS A MATTER OF WEIGHT, NOT OF HUE. A 1.5px stroke is already a
 * footnote to the figure above it; draining the colour buys restraint that
 * the thinness gives for free and pays for it with a screen that belongs to
 * no product. Callers may pass another palette colour when a card's mark
 * stands for a named series, but not to make it quieter.
 *
 * See "WHERE THE COLOURS COME FROM" in
 * specs/ai-governance/dashboard/governance-ui-controls.feature.
 */
export function GovernanceSummarySparkline({
  points,
  label,
  color = "blue.solid",
  width = 96,
  height = 28,
}: {
  /** Oldest first. Values are plotted as given; nothing is normalised away. */
  points: readonly number[];
  /**
   * What the line is a picture of, for a reader who cannot see it. Full words,
   * as everywhere else: "Agents responding over the last thirty days".
   */
  label: string;
  /**
   * A chart-palette colour, when the card's mark stands for a named series.
   * Never an `fg.*` token, and never green or red — a trend is not a verdict.
   */
  color?: string;
  width?: number;
  height?: number;
}) {
  const finite = points.filter((point) => Number.isFinite(point));

  // One point is a dot, and a dot describes no trend. Nothing to draw is drawn
  // as nothing rather than as a flat line, which would claim the series held
  // still.
  if (finite.length < 2) return null;

  const padding = 2;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const range = max - min;
  const span = width - padding * 2;
  const rise = height - padding * 2;

  const polyline = finite
    .map((point, index) => {
      const x = padding + (index / (finite.length - 1)) * span;
      // A series that never moved sits on the middle line rather than on the
      // floor, where it would read as a series pinned at zero.
      const y =
        range === 0
          ? height / 2
          : height - padding - ((point - min) / range) * rise;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <Box width={`${width}px`} height={`${height}px`} color={color}>
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        data-testid="governance-summary-sparkline"
      >
        <polyline
          points={polyline}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Box>
  );
}
