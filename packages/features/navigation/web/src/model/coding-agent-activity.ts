/**
 * Whether a project's coding-agent instrumentation is recent enough to keep
 * its sidebar destinations.
 *
 * The project rail carries a Sessions and a Pull requests destination only for
 * projects that actually send coding-agent telemetry. Both are driven by a
 * recorded moment on the project rather than a count, so a project that stops
 * sending loses the destinations again instead of keeping a link to an empty
 * page forever.
 *
 * Spec: specs/coding-agent/project-menu-links.feature.
 */

/** How long after the last signal a coding-agent destination stays offered. */
export const CODING_AGENT_LINK_WINDOW_DAYS = 15;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whether `at` falls inside the last `days` counted back from `now`.
 *
 * `now` is a parameter rather than a `Date.now()` read so the caller decides
 * the clock, which is what lets the window be asserted at an exact age instead
 * of near one. A missing or unparseable moment is outside every window: the
 * column is null until something records it, and "no signal" has to read as
 * stale rather than as fresh.
 *
 * A moment in the future counts as inside the window. Clock skew between the
 * writer and the reader is the only way to get one, and hiding a destination
 * because a server ran a few seconds ahead would be a worse answer than
 * showing it.
 */
export function withinDays({
  at,
  days,
  now,
}: {
  at: Date | string | null | undefined;
  days: number;
  now: Date;
}): boolean {
  if (!at) return false;
  const moment = at instanceof Date ? at.getTime() : Date.parse(at);
  if (Number.isNaN(moment)) return false;
  return moment > now.getTime() - days * MS_PER_DAY;
}
