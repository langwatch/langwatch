/**
 * Scenario execution configuration constants.
 *
 * All magic values extracted to named constants for clarity and maintainability.
 */

/** Queue configuration */
export const SCENARIO_QUEUE = {
  /** Queue name for BullMQ - scoped under simulations domain */
  NAME: "simulations/scenarios/executions",
  /** Job name for queue.add() */
  JOB: "scenario",
  /** How long to keep completed jobs (seconds) */
  COMPLETED_JOB_RETENTION_SECONDS: 60 * 60, // 1 hour
  /** How long to keep failed jobs (seconds) */
  FAILED_JOB_RETENTION_SECONDS: 60 * 60 * 24 * 3, // 3 days
  /** Initial delay for exponential backoff (ms) */
  BACKOFF_DELAY_MS: 1000,
  /** Number of retry attempts (1 = no retries, immediate fail after stall detection) */
  MAX_ATTEMPTS: 1,
} as const;

/** Worker configuration */
export const SCENARIO_WORKER = {
  /** Number of concurrent scenario executions */
  CONCURRENCY: 3,
  /** Interval to check for stalled jobs (ms) */
  STALLED_INTERVAL_MS: 30 * 1000, // 30 seconds
  /** How long to wait when queue is empty before checking again (ms) */
  DRAIN_DELAY_MS: 300, // Fast pickup when new jobs arrive
} as const;

/** Child process configuration */
export const CHILD_PROCESS = {
  /** Timeout for scenario child process execution (ms) */
  TIMEOUT_MS: 5 * 60 * 1000, // 5 minutes
} as const;

/**
 * @deprecated Use getOnPlatformSetId() from internal-set-id.ts instead.
 * This constant is kept for backward compatibility only.
 * @see internal-set-id.ts
 */
export const SCENARIO_DEFAULTS = {
  /** @deprecated Use getOnPlatformSetId(projectId) instead */
  PLATFORM_SET_ID: "local-scenarios",
} as const;
