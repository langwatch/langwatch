import type { TraceProjectionJob } from "../../features/trace-processing/types";
import { handleTraceProjectionJob } from "../../features/trace-processing/workers/handleTraceProjectionJob";

import { connection } from "../../redis";
import { createLogger } from "../../../utils/logger";
import { TRACE_PROJECTION_QUEUE } from "../queues/traceProjectionQueue";
import { Worker } from "bullmq";
import { BullMQOtel } from "bullmq-otel";
import os from "node:os";

const logger = createLogger("langwatch:workers:traceProjectionWorker");

export const startTraceProjectionWorker = () => {
  if (!connection) {
    logger.info("no redis connection, skipping trace projection worker");
    return;
  }

  const traceProjectionWorker = new Worker<TraceProjectionJob, void, string>(
    TRACE_PROJECTION_QUEUE,
    handleTraceProjectionJob,
    {
      connection,
      concurrency: Math.min(15, Math.max(2, Math.floor(os.cpus().length * 0.75))),
      telemetry: new BullMQOtel(TRACE_PROJECTION_QUEUE),
      limiter: {
        max: 10,
        duration: 1000,
      },
    },
  );

  traceProjectionWorker.on("ready", () => {
    logger.info("trace projection worker active, waiting for jobs!");
  });

  traceProjectionWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, "trace projection job failed");
  });

  logger.info("trace projection worker registered");

  return traceProjectionWorker;
};

