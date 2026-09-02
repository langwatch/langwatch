/**
 * The workbench run's stop signal, in Redis.
 *
 * Two keys, both short-lived: the abort flag a running loop reads between
 * cells, and the owner record an abort request is authorized against. Both
 * expire on their own after an hour, which is longer than any run can be and
 * short enough that nothing accumulates.
 *
 * The connection is injected rather than resolved from a process singleton.
 * Two replicas answering from two different Redis instances would let a run
 * ignore the stop its own caller asked for.
 */
import { createLogger } from "@langwatch/observability";
import type { Redis } from "ioredis";
import { ExperimentRunAbortPort } from "../ports/experiment-run-abort.port";

const logger = createLogger("langwatch:experiment:run-abort");

/** Redis key prefix for abort flags. */
const ABORT_KEY_PREFIX = "eval_v3_abort:";
/** Redis key prefix for the owner record of an in-flight run. */
const RUNNING_KEY_PREFIX = "eval_v3_running:";
/** TTL for both keys in seconds (1 hour — auto-cleanup). */
const ABORT_TTL_SECONDS = 3600;

export class RedisExperimentRunAbortAdapter extends ExperimentRunAbortPort {
  static create(options: { redis: Redis }): RedisExperimentRunAbortAdapter {
    return new RedisExperimentRunAbortAdapter(options.redis);
  }

  private constructor(private readonly redis: Redis) {
    super();
  }

  async requestAbort(runId: string): Promise<void> {
    await this.redis.set(`${ABORT_KEY_PREFIX}${runId}`, "1", "EX", ABORT_TTL_SECONDS);
    logger.info({ runId }, "abort flag set");
  }

  async isAborted(runId: string): Promise<boolean> {
    const value = await this.redis.get(`${ABORT_KEY_PREFIX}${runId}`);
    const isAborted = value === "1";
    // Only logged when an abort is detected; the read runs between every cell.
    if (isAborted) logger.info({ runId }, "abort flag detected");
    return isAborted;
  }

  async clearAbort(runId: string): Promise<void> {
    await this.redis.del(`${ABORT_KEY_PREFIX}${runId}`);
    logger.debug({ runId }, "abort flag cleared");
  }

  /**
   * Marks a run as running and records its owning project.
   *
   * Stored as JSON so the start timestamp stays available for listing the
   * executions currently in flight.
   */
  async setRunning({ runId, projectId }: { runId: string; projectId: string }): Promise<void> {
    await this.redis.set(
      `${RUNNING_KEY_PREFIX}${runId}`,
      JSON.stringify({ projectId, startedAt: Date.now() }),
      "EX",
      ABORT_TTL_SECONDS,
    );
  }

  async getRunningProjectId(runId: string): Promise<string | null> {
    const value = await this.redis.get(`${RUNNING_KEY_PREFIX}${runId}`);
    if (!value) return null;
    try {
      const parsed = JSON.parse(value) as { projectId?: string };
      return parsed.projectId ?? null;
    } catch {
      return null;
    }
  }

  async clearRunning(runId: string): Promise<void> {
    await this.redis.del(`${RUNNING_KEY_PREFIX}${runId}`);
  }
}
