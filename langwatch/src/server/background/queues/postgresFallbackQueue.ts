import type { CollectorJob } from "~/server/background/types";
import { connection } from "../../redis";
import { QueueWithFallback } from "./queueWithFallback";
import { processCollectorJob } from "../workers/collectorWorker";
import type { ConnectionOptions } from "bullmq";

export const POSTGRES_FALLBACK_QUEUE_NAME = "{postgres_fallback}";

export const postgresFallbackQueue = new QueueWithFallback<
  CollectorJob,
  void,
  string
>(
  POSTGRES_FALLBACK_QUEUE_NAME,
  (job) => processCollectorJob(job.id, job.data),
  {
    connection: connection as ConnectionOptions,
    defaultJobOptions: {
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      attempts: 3,
      removeOnComplete: {
        age: 0, // immediately remove completed jobs
      },
      removeOnFail: {
        age: 60 * 60 * 24 * 3, // 3 days
      },
    },
  }
);
