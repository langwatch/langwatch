// Uses plain Queue instead of QueueWithFallback because falling back to
// synchronous execution would block the event-sourcing hot path with Stripe
// API calls. When Redis is unavailable, the queue is null and dispatch skips.
import { Queue, type ConnectionOptions, type QueueOptions } from "bullmq";
import { BullMQOtel } from "bullmq-otel";
import type { UsageReportingJob } from "~/server/background/types";
import { createLogger } from "../../../utils/logger/server";
import { connection } from "../../redis";
import { USAGE_REPORTING_QUEUE } from "./constants";

const logger = createLogger("langwatch:usageReportingQueue");

function createUsageReportingQueue(): Queue<
  UsageReportingJob,
  void,
  string
> | null {
  if (!connection) {
    logger.warn(
      "Redis not available, usage reporting queue will not be created",
    );
    return null;
  }

  const opts: QueueOptions = {
    connection: connection as ConnectionOptions,
    telemetry: new BullMQOtel(USAGE_REPORTING_QUEUE.NAME),
    defaultJobOptions: {
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      attempts: 5,
      removeOnComplete: {
        age: 0, // immediately remove completed jobs
      },
      removeOnFail: {
        age: 60 * 60 * 24 * 3, // 3 days
      },
    },
  };

  return new Queue<UsageReportingJob, void, string>(
    USAGE_REPORTING_QUEUE.NAME,
    opts,
  );
}

/** Usage reporting queue instance, or null when Redis is unavailable. */
export const usageReportingQueue = createUsageReportingQueue();
