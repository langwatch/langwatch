import { Queue } from "bullmq";
import type { CollectorJob } from "~/server/background/types";
import { connection } from "../../redis";

export const COLLECTOR_QUEUE = "collector";

export const collectorQueue = connection && new Queue<CollectorJob, void, string>(
  COLLECTOR_QUEUE,
  {
    connection,
    defaultJobOptions: {
      delay: 0,
      attempts: 18, // with exponential backoff the very last attempt will happen in 3 days
      backoff: {
        type: "exponential",
        delay: 1000,
      },
      removeOnComplete: {
        age: 0, // immediately remove completed jobs
      },
      removeOnFail: {
        age: 60 * 60 * 24 * 3, // 3 days left for debugging
      },
    },
  }
);
