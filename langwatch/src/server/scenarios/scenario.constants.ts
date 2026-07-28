/**
 * Scenario execution configuration constants.
 *
 * All magic values extracted to named constants for clarity and maintainability.
 */

/**
 * Worker configuration.
 *
 * The BullMQ queue this file used to describe has had no producer and no
 * consumer for some time; dispatch is the `scenarioExecution` process
 * manager's leased outbox (ADR-073). What survives is the one number that
 * still decides something: how many scenario children a worker holds at once,
 * which the outbox reads as its dispatch concurrency.
 */
export const SCENARIO_WORKER = {
  /** Number of concurrent scenario executions per worker. */
  CONCURRENCY: 3,
} as const;

/** Child process configuration */
export const CHILD_PROCESS = {
  /** Timeout for scenario child process execution (ms) */
  TIMEOUT_MS: 15 * 60 * 1000, // 15 minutes
} as const;
