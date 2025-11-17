import type { SpanIngestionWriteJob } from "../../features/span-ingestion/types/";
import { handleSpanIngestionWriteJob } from "../../features/span-ingestion/workers/handleSpanIngestionWriteJob";

import { connection } from "../../redis";
import { createLogger } from "../../../utils/logger";
import { SPAN_INGESTION_WRITE_QUEUE } from "../queues/spanIngestionWriteQueue";
import { Worker } from "bullmq";
import { BullMQOtel } from "bullmq-otel";
import os from "node:os";


const logger = createLogger("langwatch:workers:spanIngestionWriteWorker");

export const startSpanIngestionWriteWorker = () => {
  if (!connection) {
    logger.info("no redis connection, skipping span ingestion write worker");
    return;
  }

  const spanIngestionWriteWorker = new Worker<SpanIngestionWriteJob, void, string>(
    SPAN_INGESTION_WRITE_QUEUE,
    handleSpanIngestionWriteJob,
    {
      connection,
      concurrency: Math.min(15, Math.max(2, Math.floor(os.cpus().length * 0.75))),
      telemetry: new BullMQOtel(SPAN_INGESTION_WRITE_QUEUE),
    },
  );

  spanIngestionWriteWorker.on("ready", () => {
    logger.info("span ingestion write worker active, waiting for jobs!");
  });

  spanIngestionWriteWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, "job failed");
  });

  logger.info("span ingestion write worker registered");

  return spanIngestionWriteWorker;
};
