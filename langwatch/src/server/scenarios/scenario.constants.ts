/**
 * Scenario execution configuration constants.
 *
 * All magic values extracted to named constants for clarity and maintainability.
 */

/** Queue configuration */
export const SCENARIO_QUEUE = {
  /** Queue name for BullMQ */
  NAME: "{scenarios}",
  /** How long to keep completed jobs (seconds) */
  COMPLETED_JOB_RETENTION_SECONDS: 60 * 60, // 1 hour
  /** How long to keep failed jobs (seconds) */
  FAILED_JOB_RETENTION_SECONDS: 60 * 60 * 24 * 3, // 3 days
  /** Initial delay for exponential backoff (ms) */
  BACKOFF_DELAY_MS: 1000,
  /** Number of retry attempts */
  MAX_ATTEMPTS: 3,
} as const;

/** Worker configuration */
export const SCENARIO_WORKER = {
  /** Number of concurrent scenario executions */
  CONCURRENCY: 3,
  /** Interval to check for stalled jobs (ms) */
  STALLED_INTERVAL_MS: 10 * 60 * 1000, // 10 minutes
} as const;

/** Model defaults */
export const SCENARIO_DEFAULTS = {
  /** Default LLM model when none specified */
  MODEL: "openai/gpt-4o-mini",
  /** Default set ID for local scenarios */
  SET_ID: "local-scenarios",
} as const;
