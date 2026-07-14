/**
 * Shared X-axis label geometry for the experiment-results charts.
 *
 * Cost, Latency and Win-rate label their bars with the same variant names, so
 * they must trim and slant identically — otherwise one variant reads
 * "support-c…" on one chart and "support-detailed (1)" on the next.
 */

/** Rotate X-axis labels once there are at least this many bars. */
const ROTATE_LABELS_THRESHOLD = 3;

/** Max label length before truncating, for horizontal labels. */
const MAX_LABEL_LENGTH = 14;

/**
 * Max label length for rotated labels.
 *
 * A slanted label runs diagonally rather than being boxed into its own bar's
 * slot, so it affords MORE characters than a horizontal one — but only as far
 * as ROTATED_AXIS_HEIGHT_PX covers the diagonal. Raising this without raising
 * that height clips the labels; the two must be reviewed together.
 */
const MAX_LABEL_LENGTH_ROTATED = 16;

const ROTATED_LABEL_ANGLE = -35;

/**
 * Height reserved for the X axis.
 *
 * Sized to cover a rotated label's vertical extent, NOT to fit a full
 * untruncated name — sizing for the latter made the axis eat the chart. Names
 * stay elided and the full name is shown on hover.
 */
const ROTATED_AXIS_HEIGHT_PX = 72;
const NORMAL_AXIS_HEIGHT_PX = 25;

const CHART_HEIGHT_ROTATED = 200;
const CHART_HEIGHT_NORMAL = 150;

/** Truncate a label and add ellipsis if too long. */
export const truncateLabel = (
  label: string,
  maxLength = MAX_LABEL_LENGTH,
): string => {
  if (label.length <= maxLength) return label;
  return label.slice(0, maxLength - 1) + "…";
};

/**
 * The XAxis props a chart with `barCount` bars should use.
 *
 * Every results chart must go through this rather than re-deriving the
 * rotate/height/trim ternaries at its own XAxis — those decisions have to agree
 * across charts, and a fifth copy is how they stop agreeing.
 */
export const axisLabelProps = (barCount: number) => {
  const rotate = barCount >= ROTATE_LABELS_THRESHOLD;
  return {
    angle: rotate ? ROTATED_LABEL_ANGLE : 0,
    textAnchor: rotate ? ("end" as const) : ("middle" as const),
    height: rotate ? ROTATED_AXIS_HEIGHT_PX : NORMAL_AXIS_HEIGHT_PX,
    maxLabelLength: rotate ? MAX_LABEL_LENGTH_ROTATED : MAX_LABEL_LENGTH,
  };
};

/**
 * Height for every chart in a results row, given the BUSIEST chart in it.
 *
 * Charts in a row must share a height to line up, and the height has to cover
 * the tallest axis any of them reserves. Deriving it from one chart's bar count
 * silently clips the others: a row whose Cost chart has 2 bars (no rotation,
 * short axis) but whose win-rate chart has 4 (rotated, 72px axis) would hand
 * the win-rate chart a 150px box to fit a 72px axis into. Pass the max.
 */
export const chartHeightFor = (maxBarCount: number): number =>
  maxBarCount >= ROTATE_LABELS_THRESHOLD
    ? CHART_HEIGHT_ROTATED
    : CHART_HEIGHT_NORMAL;
