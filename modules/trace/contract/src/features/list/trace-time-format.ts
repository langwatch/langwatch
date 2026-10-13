import { Temporal, toDate, toEpochMs, type TimeInput } from "@langwatch/time";

/**
 * The formats a rendered transcript prints. They live in the contract because
 * the same transcript is rendered server-side for a reader that is a model,
 * and no server graph may reach the design system these came from.
 */

/** A recorded moment as the ISO 8601 string a transcript preamble prints. */
export function isoTimestamp(value: TimeInput): string {
  return toDate(Temporal.Instant.fromEpochMilliseconds(toEpochMs(value))).toISOString();
}

/** A duration in milliseconds as `840ms` under a second, `1.4s` above it. */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}
