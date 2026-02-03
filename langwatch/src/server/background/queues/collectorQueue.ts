import type { ConnectionOptions } from "bullmq";
import type {
  CollectorCheckAndAdjustJob,
  CollectorJob,
} from "~/server/background/types";
import { connection } from "../../redis";
import { processCollectorJob } from "../workers/collectorWorker";
import { QueueWithFallback } from "./queueWithFallback";

export const COLLECTOR_QUEUE = "{collector}";

export const collectorQueue = new QueueWithFallback<
  CollectorJob | CollectorCheckAndAdjustJob,
  void,
  string
>(COLLECTOR_QUEUE, (job) => processCollectorJob(job.id, job.data), {
  connection: connection as ConnectionOptions,
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
});
