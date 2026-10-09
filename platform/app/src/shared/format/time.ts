/**
 * Compact time formatting shared by the trace surfaces and the server.
 *
 * These two live here rather than next to the rest of the trace-table
 * formatters because the conversation markdown renderer needs them, and that
 * renderer is read by both the trace drawer and the server (the LWQL
 * extraction functions render the same markdown a reader sees in the drawer).
 * Everything else in `features/traces-v2/utils/formatters.ts` is bound to the
 * table's presentation and stays there.
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Age of a timestamp in the tightest form that still reads: `now`, `12m`,
 * `3h`, `16d`. The narrow TIME column and the conversation markdown headings
 * both use it.
 */
export function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  if (diffMs < MS_PER_MINUTE) return "now";
  if (diffMs < MS_PER_HOUR) return `${Math.floor(diffMs / MS_PER_MINUTE)}m`;
  if (diffMs < MS_PER_DAY) return `${Math.floor(diffMs / MS_PER_HOUR)}h`;
  return `${Math.floor(diffMs / MS_PER_DAY)}d`;
}

/** A duration in milliseconds as `840ms` under a second, `1.4s` above it. */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}
