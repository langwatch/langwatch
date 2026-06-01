import { type Job, Worker } from "bullmq";
import { BullMQOtel } from "bullmq-otel";

import { getApp } from "~/server/app-layer/app";
import { withJobContext } from "../../context/asyncContext";
import { prisma } from "../../db";
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
import type { DataRetentionOrphanSweepJob } from "../types";
import { connection } from "../../redis";
import { DATA_RETENTION_ORPHAN_SWEEP_QUEUE } from "../queues/constants";

const logger = createLogger(
  "langwatch:workers:dataRetentionOrphanSweepWorker",
);

/**
 * Process one scheduled tick of the orphan sweep. Enumerates every
 * project and sweeps dangling PG rows whose underlying CH trace rows have
 * been TTL'd. The reactor (ingestion-driven) only fires for active
 * tenants, so this tick is the safety net for inactive ones.
 *
 * Spec: specs/data-retention/orphan-sweep.feature
 */
export async function runDataRetentionOrphanSweepJob(
  job: Job<DataRetentionOrphanSweepJob, void, string>,
): Promise<void> {
  recordJobWaitDuration(job, "data_retention_orphan_sweep");
  logger.info(
    { jobId: job.id, data: job.data },
    "processing data-retention orphan sweep tick",
  );
  getJobProcessingCounter("data_retention_orphan_sweep", "processing").inc();
  const start = Date.now();

  try {
    const projects = await prisma.project.findMany({ select: { id: true } });
    const projectIds = projects.map((p) => p.id);
    const result = await getApp().dataRetention.orphanSweep.sweepProjects({
      projectIds,
    });
    logger.info(
      {
        jobId: job.id,
        total: projectIds.length,
        swept: result.swept,
        failed: result.failed,
      },
      "data-retention orphan sweep tick complete",
    );
    getJobProcessingCounter("data_retention_orphan_sweep", "completed").inc();
    const duration = Date.now() - start;
    getJobProcessingDurationHistogram("data_retention_orphan_sweep").observe(
      duration,
    );
  } catch (error) {
    getJobProcessingCounter("data_retention_orphan_sweep", "failed").inc();
    logger.error(
      { jobId: job.id, error },
      "failed to process data-retention orphan sweep tick",
    );
    await withScope(async (scope) => {
      scope.setTag?.("worker", "dataRetentionOrphanSweep");
      scope.setExtra?.("job", job.data);
      captureException(error);
    });
  }
}

export const startDataRetentionOrphanSweepWorker = () => {
  if (!connection) {
    logger.info(
      "no redis connection, skipping data-retention orphan sweep worker",
    );
    return;
  }

  const worker = new Worker<DataRetentionOrphanSweepJob, void, string>(
    DATA_RETENTION_ORPHAN_SWEEP_QUEUE.NAME,
    withJobContext(runDataRetentionOrphanSweepJob),
    {
      connection,
      concurrency: 1,
      telemetry: new BullMQOtel(DATA_RETENTION_ORPHAN_SWEEP_QUEUE.NAME),
    },
  );

  worker.on("ready", () => {
    logger.info(
      "data-retention orphan sweep worker active, waiting for jobs!",
    );
  });

  worker.on("failed", async (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, "job failed");
    getJobProcessingCounter("data_retention_orphan_sweep", "failed").inc();
    await withScope((scope) => {
      scope.setTag?.("worker", "dataRetentionOrphanSweep");
      scope.setExtra?.("job", job?.data);
      captureException(err);
    });
  });

  logger.info("data-retention orphan sweep worker registered");
  return worker;
};
