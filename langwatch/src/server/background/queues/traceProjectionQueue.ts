import type { ConnectionOptions } from "bullmq";
import { BullMQOtel } from "bullmq-otel";

import { connection } from "../../redis";
import { QueueWithFallback } from "./queueWithFallback";
import type { TraceProjectionJob } from "../../features/trace-processing/types";
import { handleTraceProjectionJob } from "../../features/trace-processing/workers/handleTraceProjectionJob";

export const TRACE_PROJECTION_QUEUE = "{trace_projection}";
export const TRACE_PROJECTION_JOB_NAME = "trace_projection";

export const traceProjectionQueue = new QueueWithFallback<
  TraceProjectionJob,
  void,
  string
>(TRACE_PROJECTION_QUEUE, handleTraceProjectionJob, {
  connection: connection as ConnectionOptions,
  telemetry: new BullMQOtel(TRACE_PROJECTION_QUEUE),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 60 * 60 * 24 * 7,
    },
  },
});

