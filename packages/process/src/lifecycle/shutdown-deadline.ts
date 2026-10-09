/**
 * The process watchdog sits above the queue drain, leaving room for the rest
 * of the teardown. The chart renders both from one shutdownDrainSeconds with
 * the same slack (langwatch.shutdownEnv in charts/langwatch).
 */

/** Room above the queue drain for App.close (5s) and process teardown (15s). */
export const SHUTDOWN_CLOSE_SLACK_MS = 20_000;

/** The deadline when neither the deadline nor the drain is configured. */
export const DEFAULT_SHUTDOWN_DEADLINE_MS = 60_000;

/** An explicit deadline wins; otherwise it follows the drain it must outlast. */
export function processShutdownDeadlineMs({
  deadlineMs,
  queueDrainMs,
}: Readonly<{ deadlineMs: number | undefined; queueDrainMs: number | undefined }>): number {
  if (deadlineMs !== undefined) return deadlineMs;
  if (queueDrainMs === undefined) return DEFAULT_SHUTDOWN_DEADLINE_MS;
  return queueDrainMs + SHUTDOWN_CLOSE_SLACK_MS;
}

/** The http door's own phase ceiling: half the 15s process teardown (main's budget.ts). */
export const HTTP_CLOSE_PHASE_MS = 7_500;

/** What in-flight requests get; the ceiling keeps 2s for the session teardown and the reap. */
export const HTTP_DRAIN_GRACE_MS = HTTP_CLOSE_PHASE_MS - 2_000;
