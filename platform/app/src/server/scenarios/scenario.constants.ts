/**
 * Scenario execution configuration constants.
 *
 * All magic values extracted to named constants for clarity and maintainability.
 */

import { makeQueueName } from "../queues/makeQueueName";

/** Queue configuration */
export const SCENARIO_QUEUE = {
  /** Queue name - scoped under simulations domain */
  NAME: makeQueueName("simulations/scenarios/executions"),
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
  TIMEOUT_MS: 15 * 60 * 1000, // 15 minutes
} as const;

/**
 * Threshold in milliseconds after which a run without activity is
 * considered stalled. Set to 2x the child process timeout
 * to cover all reasonable completion scenarios.
 *
 * This is the simulationRunExecution process manager's stall-watchdog
 * threshold: the wake fires once a run has been quiet this long and
 * force-finishes it ERROR with reason "stalled". Stored status is the
 * only truth — nothing derives STALLED at read time anymore.
 */
export const STALL_THRESHOLD_MS = CHILD_PROCESS.TIMEOUT_MS * 2;
