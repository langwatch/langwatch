/**
 * When an on-message monitor's runs are mostly errors.
 * Spec: modules/evaluation/specs/monitor-error-rate.feature
 */

/** The window the counts cover, and the bucket width they are kept in. */
export const MONITOR_ERROR_RATE_WINDOW_MS = 60 * 60 * 1000;
const MONITOR_ERROR_RATE_BUCKET_MS = 5 * 60 * 1000;
/** Fewer settled runs than this in the window never pause a monitor. */
const MONITOR_ERROR_RATE_MINIMUM_RUNS = 50;
/** The share of settled runs that must be errors. */
const MONITOR_ERROR_RATE_THRESHOLD = 0.9;
/** The longest error message the fact carries. */
export const MONITOR_ERROR_MESSAGE_MAX_LENGTH = 200;

export type MonitorRunOutcome = "processed" | "error" | "skipped";

/** The window's settled runs (processed or error) and how many of them errored. */
export type MonitorErrorRateCounts = Readonly<{ runs: number; errors: number }>;

/** Only runs LangWatch executes for an on-message monitor count; guardrails never pause. */
export function isCountedMonitorRun({
  executionMode,
  isGuardrail,
}: {
  executionMode: string;
  isGuardrail: boolean;
}): boolean {
  return executionMode === "ON_MESSAGE" && !isGuardrail;
}

export function isMonitorErrorRateExceeded({ runs, errors }: MonitorErrorRateCounts): boolean {
  return runs >= MONITOR_ERROR_RATE_MINIMUM_RUNS && errors / runs >= MONITOR_ERROR_RATE_THRESHOLD;
}

/** The buckets the window reads, newest first, for an instant in epoch milliseconds. */
export function monitorErrorRateBuckets(now: number): number[] {
  const newest = Math.floor(now / MONITOR_ERROR_RATE_BUCKET_MS);
  const count = MONITOR_ERROR_RATE_WINDOW_MS / MONITOR_ERROR_RATE_BUCKET_MS;
  return Array.from({ length: count }, (_, index) => newest - index);
}

const REDACTIONS: readonly [RegExp, string][] = [
  [/(:\/\/)[^\s/:@]+:[^\s/@]+@/g, "$1[redacted]@"],
  [/\b(bearer|basic)\s+[\w.~+/=-]+/gi, "$1 [redacted]"],
  [
    /\b(api[_-]?key|token|secret|password|authorization)(["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi,
    "$1$2[redacted]",
  ],
  [/\b(sk|pk|rk|lw|key|AKIA)[-_][\w-]{8,}/g, "[redacted]"],
  [/\b[\w-]{40,}\b/g, "[redacted]"],
];

/**
 * An error message safe to count and to email: secrets redacted, ids and numbers folded so
 * the same failure reads as one message, whitespace collapsed, at most 200 characters.
 */
export function normalizeMonitorErrorMessage(message: string): string {
  let normalized = message;
  for (const [pattern, replacement] of REDACTIONS) {
    normalized = normalized.replace(pattern, replacement);
  }
  normalized = normalized
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\b\d{5,}\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= MONITOR_ERROR_MESSAGE_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, MONITOR_ERROR_MESSAGE_MAX_LENGTH - 3)}...`;
}
