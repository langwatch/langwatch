import type { ConnectionOptions } from "bullmq";
import type { AnomalyDetectionJob } from "~/server/background/types";

import { createLogger } from "../../../utils/logger/server";
import { connection } from "../../redis";
import { runAnomalyDetectionJob } from "../workers/anomalyDetectionWorker";
import { ANOMALY_DETECTION_QUEUE } from "./constants";
import { QueueWithFallback } from "./queueWithFallback";

export { ANOMALY_DETECTION_QUEUE } from "./constants";

const logger = createLogger("langwatch:anomalyDetectionQueue");

/**
 * Default tick interval — every 5 minutes. Tight enough that operators
 * see anomalies within a single coffee break, loose enough that the
 * evaluator query load stays trivial. Configurable via env at the
 * scheduling site if a customer wants tighter (e.g. compliance-tier
 * SLA on detection-to-alert).
 */
const DEFAULT_TICK_PATTERN = "*/5 * * * *";

export const anomalyDetectionQueue = new QueueWithFallback<
  AnomalyDetectionJob,
  void,
  string
>(ANOMALY_DETECTION_QUEUE.NAME, runAnomalyDetectionJob, {
  connection: connection as ConnectionOptions,
  defaultJobOptions: {
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    attempts: 3,
    removeOnComplete: {
      age: 60 * 60 * 24, // 1 day — keep recent ticks for debug visibility
    },
    removeOnFail: {
      age: 60 * 60 * 24 * 7, // 7 days — keep failed ticks longer for triage
    },
  },
});

/**
 * Register the scheduled anomaly-detection tick. Called once at worker
 * startup. Idempotent — re-scheduling with the same jobId is a no-op
 * past the first call (BullMQ repeat behavior).
 */
export const scheduleAnomalyDetection = async (): Promise<void> => {
  if (!connection) {
    logger.info(
      "no redis connection, skipping anomaly detection scheduling",
    );
    return;
  }

  try {
    await anomalyDetectionQueue.add(
      ANOMALY_DETECTION_QUEUE.JOB,
      { timestamp: Date.now() },
      {
        jobId: "anomaly_detection_tick",
        repeat: { pattern: DEFAULT_TICK_PATTERN },
      },
    );
    logger.info(
      { pattern: DEFAULT_TICK_PATTERN },
      "anomaly detection tick scheduled",
    );
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "failed to schedule anomaly detection tick",
    );
  }
};
