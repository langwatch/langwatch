import type { ConnectionOptions } from "bullmq";
import { createLogger } from "../../../utils/logger/server";
import { connection } from "../../redis";
import {
  type LangyRetentionJob,
  runLangyRetentionJob,
} from "../workers/langyRetentionWorker";
import { LANGY_RETENTION_QUEUE } from "./constants";
import { QueueWithFallback } from "./queueWithFallback";

export { LANGY_RETENTION_QUEUE } from "./constants";

const logger = createLogger("langwatch:langyRetentionQueue");

export const langyRetentionQueue = new QueueWithFallback<
  LangyRetentionJob,
  void,
  string
>(LANGY_RETENTION_QUEUE.NAME, runLangyRetentionJob, {
  connection: connection as ConnectionOptions,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 0 },
    removeOnFail: { age: 60 * 60 * 24 * 7 },
  },
});

/**
 * Schedule the daily retention sweep. Runs at 03:00 UTC.
 */
export const scheduleLangyRetention = async () => {
  if (!connection) {
    logger.info("no redis connection, skipping langy retention schedule");
    return;
  }
  return await langyRetentionQueue.add(
    LANGY_RETENTION_QUEUE.JOB,
    { scheduledAt: Date.now() },
    {
      jobId: "langy_retention_daily",
      repeat: {
        pattern: "0 3 * * *",
      },
    },
  );
};
