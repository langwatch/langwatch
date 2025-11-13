import type { ConnectionOptions } from "bullmq";

import { connection } from "../../redis";
import { QueueWithFallback } from "./queueWithFallback";
import type { SpanIngestionWriteJob } from "../../features/span-ingestion/types/";
import { handleSpanIngestionWriteJob } from "../../features/span-ingestion/workers/handleSpanIngestionWriteJob";

export const SPAN_INGESTION_WRITE_QUEUE = "{span_ingestion_write}";
export const SPAN_INGESTION_WRITE_JOB_NAME = "span_ingestion_write";

export const spanIngestionWriteQueue = new QueueWithFallback<
  SpanIngestionWriteJob,
  void,
  string
>(SPAN_INGESTION_WRITE_QUEUE, handleSpanIngestionWriteJob, {
  connection: connection as ConnectionOptions,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: {
      age: 0,
    },
    removeOnFail: {
      age: 60 * 60 * 24,
    },
  },
});
