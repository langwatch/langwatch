import { Queue } from "bullmq";
import type { CollectorJob } from "~/server/background/types";
import { connection } from "../../redis";

export const COLLECTOR_QUEUE = "collector";

export const collectorQueue = new Queue<CollectorJob, void, string>(
  COLLECTOR_QUEUE,
  {
    connection,
    defaultJobOptions: {
      backoff: {
        type: "exponential",
        delay: 5000,
      },
    },
  }
);