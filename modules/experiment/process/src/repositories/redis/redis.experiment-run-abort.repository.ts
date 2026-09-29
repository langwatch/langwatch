/**
 * The workbench run's stop signal in Redis: one short-lived abort flag a cell reads, where every
 * replica answers from the same instance.
 */
import { createLogger } from "@langwatch/observability";
import type { ProcessMembers } from "@langwatch/process-stores/members";

import { ExperimentRunAbortRepository } from "../experiment-run-abort.repository.ts";

const logger = createLogger("langwatch:experiment:run-abort");

/** Redis key prefix for abort flags. */
const ABORT_KEY_PREFIX = "eval_v3_abort:";
/** TTL of the flag in seconds (1 hour — auto-cleanup). */
const ABORT_TTL_SECONDS = 3600;

export class RedisExperimentRunAbortRepository extends ExperimentRunAbortRepository {
  static create(options: { redis: ProcessMembers["redis"] }): RedisExperimentRunAbortRepository {
    return new RedisExperimentRunAbortRepository(options.redis);
  }

  private constructor(private readonly redis: ProcessMembers["redis"]) {
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
}
