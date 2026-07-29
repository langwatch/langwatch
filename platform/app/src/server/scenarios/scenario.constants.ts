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
  /**
   * How long a shutdown will wait, in total, for the runs this worker is
   * holding to be recorded as finished.
   *
   * Sized against the pod's termination grace period (30s by default) rather
   * than against how long the writes take: at most `CONCURRENCY` of them run
   * at once and each is a lookup plus one dispatched event, so the budget is
   * only ever spent when something downstream is already unhealthy. Ten
   * seconds leaves the rest of the grace period for the other shutdown
   * handles and for closing the App — the same reasoning the group queue's
   * own shutdown bound uses.
   *
   * Exceeding it is not a failure: the run keeps the durable deadline the
   * process manager armed, so the bound trades a slower terminal write for a
   * shutdown that always completes.
   */
  SHUTDOWN_SETTLE_TIMEOUT_MS: 10_000,
} as const;

/** Child process configuration */
export const CHILD_PROCESS = {
  /** Timeout for scenario child process execution (ms) */
  TIMEOUT_MS: 15 * 60 * 1000, // 15 minutes
} as const;
