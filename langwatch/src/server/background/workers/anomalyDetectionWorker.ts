import { type Job, Worker } from "bullmq";
import { BullMQOtel } from "bullmq-otel";

import { withJobContext } from "../../context/asyncContext";
import { prisma } from "../../db";
import { SpendSpikeAnomalyEvaluator } from "~/server/governance/spendSpikeAnomalyEvaluator.service";
import { createLogger } from "../../../utils/logger/server";
import {
  captureException,
  withScope,
} from "../../../utils/posthogErrorCapture";
import {
  recordJobWaitDuration,
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../../metrics";
import type { AnomalyDetectionJob } from "../types";
import { connection } from "../../redis";
import { ANOMALY_DETECTION_QUEUE } from "../queues/constants";

const logger = createLogger("langwatch:workers:anomalyDetectionWorker");

/**
 * Process one scheduled tick of the anomaly evaluator. Lists active
 * spend_spike rules across all orgs, evaluates each against
 * governance_kpis, persists AnomalyAlert rows for fire decisions.
 *
 * Spec: specs/ai-gateway/governance/anomaly-rules.feature
 */
export async function runAnomalyDetectionJob(
  job: Job<AnomalyDetectionJob, void, string>,
): Promise<void> {
  recordJobWaitDuration(job, "anomaly_detection");
  logger.info(
    { jobId: job.id, data: job.data },
    "processing anomaly detection job",
  );
  getJobProcessingCounter("anomaly_detection", "processing").inc();
  const start = Date.now();

  try {
    const evaluator = SpendSpikeAnomalyEvaluator.create(prisma);
    const result = await evaluator.evaluateAll({
      now: new Date(job.data.timestamp),
    });
    logger.info(
      {
        jobId: job.id,
        rulesEvaluated: result.rulesEvaluated,
        alertsFired: result.alertsFired,
        skipped: result.skipped,
      },
      "anomaly detection tick complete",
    );
    getJobProcessingCounter("anomaly_detection", "completed").inc();
    const duration = Date.now() - start;
    getJobProcessingDurationHistogram("anomaly_detection").observe(duration);
  } catch (error) {
    getJobProcessingCounter("anomaly_detection", "failed").inc();
    logger.error(
      { jobId: job.id, error },
      "failed to process anomaly detection job",
    );
    await withScope(async (scope) => {
      scope.setTag?.("worker", "anomalyDetection");
      scope.setExtra?.("job", job.data);
      captureException(error);
    });
  }
}

export const startAnomalyDetectionWorker = () => {
  if (!connection) {
    logger.info(
      "no redis connection, skipping anomaly detection worker",
    );
    return;
  }

  const anomalyDetectionWorker = new Worker<AnomalyDetectionJob, void, string>(
    ANOMALY_DETECTION_QUEUE.NAME,
    withJobContext(runAnomalyDetectionJob),
    {
      connection,
      concurrency: 1,
      telemetry: new BullMQOtel(ANOMALY_DETECTION_QUEUE.NAME),
    },
  );

  anomalyDetectionWorker.on("ready", () => {
    logger.info("anomaly detection worker active, waiting for jobs!");
  });

  anomalyDetectionWorker.on("failed", async (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, "job failed");
    getJobProcessingCounter("anomaly_detection", "failed").inc();
    await withScope((scope) => {
      scope.setTag?.("worker", "anomalyDetection");
      scope.setExtra?.("job", job?.data);
      captureException(err);
    });
  });

  logger.info("anomaly detection worker registered");
  return anomalyDetectionWorker;
};
