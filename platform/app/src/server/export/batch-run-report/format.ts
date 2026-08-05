/**
 * Formatting shared by everything that computes a report.
 *
 * One implementation each, because two of them drift: a duration written twice
 * rendered the same run as "7s" at the top of the page and "7.2s" a screen
 * further down, which reads as two different measurements of the same thing.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

/**
 * A wall-clock duration, at a precision that matches its size.
 *
 * Sub-minute runs keep a decimal because the difference between 1.2s and 7.2s
 * is worth seeing; past a minute it is noise, and past an hour so is the
 * seconds column.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;

  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Money, or nothing at all.
 *
 * A run with no recorded cost is not a free run, so it says nothing rather than
 * "$0.00" — which would read as a measurement that was taken.
 */
export function formatCost(cost: number | null): string | null {
  if (cost === null || cost <= 0) return null;
  return cost < 0.01 ? "<$0.01" : `$${cost.toFixed(2)}`;
}
