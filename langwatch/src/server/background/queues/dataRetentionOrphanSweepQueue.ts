import type { ConnectionOptions } from "bullmq";
import type { DataRetentionOrphanSweepJob } from "~/server/background/types";

import { createLogger } from "../../../utils/logger/server";
import { connection } from "../../redis";
import { runDataRetentionOrphanSweepJob } from "../workers/dataRetentionOrphanSweepWorker";
import { DATA_RETENTION_ORPHAN_SWEEP_QUEUE } from "./constants";
import { QueueWithFallback } from "./queueWithFallback";

export { DATA_RETENTION_ORPHAN_SWEEP_QUEUE } from "./constants";

const logger = createLogger("langwatch:dataRetentionOrphanSweepQueue");

/**
 * Default tick interval — every 6 hours. The ingestion reactor handles
 * active tenants; this tick exists to catch tenants that have stopped
 * ingesting. Dangling PG rows aren't urgent (they don't break anything),
 * so a daytime-friendly 4×/day cadence is plenty.
 */
const DEFAULT_TICK_PATTERN = "0 */6 * * *";

export const dataRetentionOrphanSweepQueue = new QueueWithFallback<
  DataRetentionOrphanSweepJob,
  void,
  string
>(DATA_RETENTION_ORPHAN_SWEEP_QUEUE.NAME, runDataRetentionOrphanSweepJob, {
  connection: connection as ConnectionOptions,
  defaultJobOptions: {
    backoff: { type: "exponential", delay: 5000 },
    attempts: 3,
    removeOnComplete: {
      age: 60 * 60 * 24,
    },
    removeOnFail: {
      age: 60 * 60 * 24 * 7,
    },
  },
});

/**
 * Register the scheduled data-retention orphan-sweep tick. Called once at
 * worker startup. Idempotent — re-scheduling with the same jobId is a
 * no-op past the first call (BullMQ repeat behavior).
 */
export const scheduleDataRetentionOrphanSweep = async (): Promise<void> => {
  if (!connection) {
    logger.info(
      "no redis connection, skipping data-retention orphan sweep scheduling",
    );
    return;
  }

  try {
    await dataRetentionOrphanSweepQueue.add(
      DATA_RETENTION_ORPHAN_SWEEP_QUEUE.JOB,
      { timestamp: Date.now() },
      {
        jobId: "data_retention_orphan_sweep_tick",
        repeat: { pattern: DEFAULT_TICK_PATTERN },
      },
    );
    logger.info(
      { pattern: DEFAULT_TICK_PATTERN },
      "data-retention orphan sweep tick scheduled",
    );
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "failed to schedule data-retention orphan sweep tick",
    );
  }
};
