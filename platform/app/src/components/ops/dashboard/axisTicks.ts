/**
 * Tick maths for the throughput chart's two y-axes.
 *
 * The chart plots rates on the left and counts on the right. Deriving each
 * maximum independently and letting the chart library choose ticks per axis
 * puts two sets of gridlines at unrelated heights, so a reader cannot tell
 * which line belongs to which scale — the axes visually contradict each other
 * even when both are correct.
 *
 * The fix is to fix the DIVISION rather than the values: both axes are cut into
 * the same number of intervals, so every gridline is shared and each axis only
 * has to label its own range.
 */

/** Gridline count is shared by both axes; 4 intervals reads well at chart height. */
export const AXIS_INTERVALS = 4;

/** Round up to a "nice" axis maximum (1, 2, 5, 10, 20, 50, …). */
export function niceMax(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

/**
 * A maximum that divides cleanly into `AXIS_INTERVALS`, so every tick is a
 * round number rather than a repeating decimal.
 *
 * The rounding happens in units of the value's OWN magnitude, not in whole
 * numbers. Rounding to a whole multiple of the interval count destroys a
 * sub-unit axis: a completed-per-second rate peaking at 0.25 would take an
 * axis maximum of 4, flattening the series onto the baseline — and idle rates
 * below 1/s are the common case on a quiet queue, not an edge case.
 */
export function alignedMax(raw: number): number {
  // `niceMax` already returns 1, 2, 5 or 10 times a power of ten, and each of
  // those divides into four parts that terminate (0.25, 0.5, 1.25, 2.5 …), so
  // it needs no further alignment. The earlier version rounded up to a whole
  // multiple of the interval count, which is what broke sub-unit axes.
  return niceMax(raw);
}

/** Evenly spaced ticks from 0 to `max`, one per shared gridline. */
export function axisTicks(max: number): number[] {
  const top = alignedMax(max);
  const step = top / AXIS_INTERVALS;
  return Array.from({ length: AXIS_INTERVALS + 1 }, (_, i) => i * step);
}

/**
 * Width to reserve for an axis, derived from its longest formatted label.
 *
 * An axis sized for `500` clips `500.0k`, which is exactly the case that shows
 * up when a count series runs into the hundreds of thousands.
 */
export function axisWidthFor(ticks: number[], format: (value: number) => string): number {
  const longest = ticks.reduce((max, tick) => Math.max(max, format(tick).length), 1);
  // ~7px per character at the chart's 10px tick font, plus breathing room so
  // the label never touches the plot area.
  return Math.max(32, longest * 7 + 8);
}
