import { connection } from "~/server/redis";
import { createLogger } from "~/utils/logger";

const logger = createLogger("evaluations-v3:abort-manager");

/**
 * Redis key prefix for abort flags.
 */
const ABORT_KEY_PREFIX = "eval_v3_abort:";

/**
 * TTL for abort flags in seconds (1 hour - auto-cleanup).
 */
const ABORT_TTL_SECONDS = 3600;

/**
 * Manages abort flags for evaluation executions using Redis.
 * Provides fast abort checking between cell executions.
 */
export const abortManager = {
  /**
   * Set the abort flag for a run, requesting it to stop.
   */
  async requestAbort(runId: string): Promise<void> {
    if (!connection) {
      logger.warn("Redis not available, abort request ignored");
      return;
    }

    const key = `${ABORT_KEY_PREFIX}${runId}`;
    await connection.set(key, "1", "EX", ABORT_TTL_SECONDS);
    logger.info({ runId }, "Abort requested");
  },

  /**
   * Check if an abort has been requested for a run.
   * Returns true if the run should stop.
   */
  async isAborted(runId: string): Promise<boolean> {
    if (!connection) {
      // If Redis is not available, don't block execution
      return false;
    }

    const key = `${ABORT_KEY_PREFIX}${runId}`;
    const value = await connection.get(key);
    return value === "1";
  },

  /**
   * Clear the abort flag for a run (cleanup after execution completes).
   */
  async clearAbort(runId: string): Promise<void> {
    if (!connection) {
      return;
    }

    const key = `${ABORT_KEY_PREFIX}${runId}`;
    await connection.del(key);
    logger.info({ runId }, "Abort flag cleared");
  },

  /**
   * Mark a run as "running" (for tracking active executions).
   * This can be used to list active executions if needed.
   */
  async setRunning(runId: string): Promise<void> {
    if (!connection) {
      return;
    }

    const key = `eval_v3_running:${runId}`;
    await connection.set(key, Date.now().toString(), "EX", ABORT_TTL_SECONDS);
  },

  /**
   * Clear the running flag (cleanup after execution completes).
   */
  async clearRunning(runId: string): Promise<void> {
    if (!connection) {
      return;
    }

    const key = `eval_v3_running:${runId}`;
    await connection.del(key);
  },
};

/**
 * Type for the abort manager (for dependency injection in tests).
 */
export type AbortManager = typeof abortManager;
