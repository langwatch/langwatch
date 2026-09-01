/**
 * Tick maths for the throughput chart's two y-axes.
 *
 * The chart plots rates on the left and counts on the right. Deriving each
 * maximum independently and letting the chart library choose ticks per axis
 * puts two sets of gridlines at unrelated heights, so a reader cannot tell
 * which line belongs to which scale — the axes visually contradict each other
 * even when both are correct.
 */

/** Gridline count is shared by both axes; 4 intervals reads well at chart height. */
export const AXIS_INTERVALS = 4;

/** Round up to a "nice" axis maximum (1, 2, 5, 10, 20, 50, …). */
export function niceMax(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

/** A maximum that divides cleanly into the shared gridline intervals. */
export function alignedMax(raw: number): number {
  return niceMax(raw);
}

/** Evenly spaced ticks from 0 to `max`, one per shared gridline. */
export function axisTicks(max: number): number[] {
  const top = alignedMax(max);
  const step = top / AXIS_INTERVALS;
  return Array.from({ length: AXIS_INTERVALS + 1 }, (_, i) => i * step);
}

/** Width to reserve for an axis, derived from its longest formatted label. */
export function axisWidthFor(ticks: number[], format: (value: number) => string): number {
  const longest = ticks.reduce((max, tick) => Math.max(max, format(tick).length), 1);
  return Math.max(32, longest * 7 + 8);
}
