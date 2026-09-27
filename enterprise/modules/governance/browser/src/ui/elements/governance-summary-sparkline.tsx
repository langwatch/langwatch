/** Sparkline showing series shape with no axes or numbers; drawn as polyline. */

import { Box } from "@chakra-ui/react";

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
      const y = range === 0 ? height / 2 : height - padding - ((point - min) / range) * rise;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <Box width={`${width}px`} height={`${height}px`} color={color}>
      <svg
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        data-testid="governance-summary-sparkline"
      >
        <title>{label}</title>
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
