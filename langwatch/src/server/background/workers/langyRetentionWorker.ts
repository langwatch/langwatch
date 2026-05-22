import { type Job, Worker } from "bullmq";
import { BullMQOtel } from "bullmq-otel";
import { withJobContext } from "../../context/asyncContext";
import { createLogger } from "../../../utils/logger/server";
import {
  captureException,
  withScope,
} from "../../../utils/posthogErrorCapture";
import {
  getJobProcessingCounter,
  recordJobWaitDuration,
} from "../../metrics";
import { connection } from "../../redis";
import { prisma } from "../../db";
import { LANGY_RETENTION_QUEUE } from "../queues/constants";
import { LangyConversationService } from "../../services/langy";

const logger = createLogger("langwatch:workers:langyRetentionWorker");

export const LANGY_HARD_DELETE_AFTER_DAYS = 90;

export type LangyRetentionJob = {
  scheduledAt: number;
};

export async function runLangyRetentionJob(
  job: Job<LangyRetentionJob, void, string>,
) {
  recordJobWaitDuration(job, "langy_retention");
  getJobProcessingCounter("langy_retention", "processing").inc();
  try {
    const cutoff = new Date(
      Date.now() - LANGY_HARD_DELETE_AFTER_DAYS * 24 * 60 * 60 * 1000,
    );
    const service = LangyConversationService.create(prisma);
    const result = await service.hardDeleteOlderThan({ cutoff });
    logger.info({ ...result, cutoff }, "langy retention sweep complete");
    getJobProcessingCounter("langy_retention", "completed").inc();
  } catch (error) {
    getJobProcessingCounter("langy_retention", "failed").inc();
    logger.error({ jobId: job.id, error }, "langy retention sweep failed");
    await withScope(async (scope) => {
      scope.setTag?.("worker", "langyRetention");
      captureException(error);
    });
    throw error;
  }
}

export const startLangyRetentionWorker = () => {
  if (!connection) {
    logger.info("no redis connection, skipping langy retention worker");
    return;
  }
  const worker = new Worker<LangyRetentionJob, void, string>(
    LANGY_RETENTION_QUEUE.NAME,
    withJobContext(runLangyRetentionJob),
    {
      connection,
      concurrency: 1,
      telemetry: new BullMQOtel(LANGY_RETENTION_QUEUE.NAME),
    },
  );
  worker.on("ready", () => {
    logger.info("langy retention worker active");
  });
  worker.on("failed", async (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, "retention job failed");
    getJobProcessingCounter("langy_retention", "failed").inc();
    await withScope((scope) => {
      scope.setTag?.("worker", "langyRetention");
      captureException(err);
    });
  });
  return worker;
};
