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
import type { OrphanSweepChainJob } from "../types";
import { connection } from "../../redis";
import { ORPHAN_SWEEP_CHAIN_QUEUE } from "../queues/constants";
import {
  ORPHAN_SWEEP_CHAIN_INTERVAL_MS,
  seedOrphanSweepChain,
} from "../queues/orphanSweepChainQueue";

const logger = createLogger("langwatch:workers:orphanSweepChainWorker");

/**
 * Return value the worker hands back to the queue's `completed` listener so
 * it can decide whether to re-enqueue. `stopChain: true` ends the loop for
 * this tenant — used when the project is archived or hard-deleted.
 */
export type OrphanSweepChainOutcome = { stopChain: boolean };

/**
 * Process one step of a tenant's orphan-sweep chain:
 *   1. Verify the project still exists and isn't archived. If not, break
 *      the chain — don't re-enqueue.
 *   2. Run the sweep. Transient failures are logged but DON'T break the
 *      chain — the next step (24h later) will retry. Otherwise a single
 *      flaky run could silence a tenant's cleanup forever.
 *
 * The 24h re-enqueue lives in the worker's `completed` listener, NOT here.
 * Re-enqueuing inside `handle` would race against the still-active jobId
 * and BullMQ would dedup our new add into a no-op — the chain would stall.
 */
export async function runOrphanSweepChainJob(
  job: Job<OrphanSweepChainJob, OrphanSweepChainOutcome, string>,
): Promise<OrphanSweepChainOutcome> {
  recordJobWaitDuration(job, "orphan_sweep_chain");
  const { tenantId } = job.data;
  logger.info({ jobId: job.id, tenantId }, "processing orphan sweep chain step");
  getJobProcessingCounter("orphan_sweep_chain", "processing").inc();
  const start = Date.now();

  try {
    const project = await prisma.project.findUnique({
      where: { id: tenantId },
      select: { id: true, archivedAt: true },
    });
    if (!project || project.archivedAt !== null) {
      logger.info(
        {
          tenantId,
          exists: !!project,
          archived: !!project?.archivedAt,
        },
        "orphan sweep chain stopping — project archived or deleted",
      );
      getJobProcessingCounter("orphan_sweep_chain", "completed").inc();
      return { stopChain: true };
    }

    try {
      await getApp().dataRetention.orphanSweep.sweepProject({
        projectId: tenantId,
      });
    } catch (error) {
      // Chain resilience: a transient sweep failure must NOT silence the
      // chain for this tenant forever. Log and let the next step (24h later)
      // try again — exactly the behavior the user gets for any other run.
      logger.error(
        { tenantId, error },
        "orphan sweep step failed; chain continues — next step in 24h will retry",
      );
    }

    getJobProcessingCounter("orphan_sweep_chain", "completed").inc();
    const duration = Date.now() - start;
    getJobProcessingDurationHistogram("orphan_sweep_chain").observe(duration);
    return { stopChain: false };
  } catch (error) {
    getJobProcessingCounter("orphan_sweep_chain", "failed").inc();
    logger.error(
      { jobId: job.id, tenantId, error },
      "orphan sweep chain step crashed",
    );
    await withScope(async (scope) => {
      scope.setTag?.("worker", "orphanSweepChain");
      scope.setExtra?.("job", job.data);
      captureException(error);
    });
    throw error;
  }
}

export const startOrphanSweepChainWorker = () => {
  if (!connection) {
    logger.info("no redis connection, skipping orphan sweep chain worker");
    return;
  }

  const worker = new Worker<OrphanSweepChainJob, OrphanSweepChainOutcome, string>(
    ORPHAN_SWEEP_CHAIN_QUEUE.NAME,
    withJobContext(runOrphanSweepChainJob),
    {
      connection,
      concurrency: 1,
      telemetry: new BullMQOtel(ORPHAN_SWEEP_CHAIN_QUEUE.NAME),
    },
  );

  worker.on("ready", () => {
    logger.info("orphan sweep chain worker active, waiting for jobs!");
  });

  // The self-perpetuating link. Re-enqueue MUST happen here, after the
  // previous job has transitioned out of `active` and its jobId is free —
  // otherwise BullMQ dedups the add into a no-op and the chain stalls.
  worker.on("completed", async (job, returnValue) => {
    const outcome = returnValue as OrphanSweepChainOutcome | undefined;
    if (!job?.data?.tenantId) return;
    if (outcome?.stopChain) {
      logger.info(
        { tenantId: job.data.tenantId },
        "orphan sweep chain ended for tenant — project archived or deleted",
      );
      return;
    }
    try {
      await seedOrphanSweepChain(job.data.tenantId, {
        delayMs: ORPHAN_SWEEP_CHAIN_INTERVAL_MS,
      });
    } catch (error) {
      logger.error(
        { tenantId: job.data.tenantId, error },
        "failed to schedule next orphan sweep chain step — chain may stall for this tenant until next ingest",
      );
    }
  });

  // If a step exhausts retries we still try to re-link the chain — a
  // permanent failure on one step shouldn't kill the tenant's cleanup
  // forever. Worst case the next step also fails and BullMQ telemetry
  // surfaces it.
  worker.on("failed", async (job, err) => {
    logger.error(
      { jobId: job?.id, error: err.message },
      "orphan sweep chain step failed permanently; attempting to keep the chain alive",
    );
    getJobProcessingCounter("orphan_sweep_chain", "failed").inc();
    await withScope((scope) => {
      scope.setTag?.("worker", "orphanSweepChain");
      scope.setExtra?.("job", job?.data);
      captureException(err);
    });
    if (!job?.data?.tenantId) return;
    try {
      await seedOrphanSweepChain(job.data.tenantId, {
        delayMs: ORPHAN_SWEEP_CHAIN_INTERVAL_MS,
      });
    } catch (error) {
      logger.error(
        { tenantId: job.data.tenantId, error },
        "failed to schedule next orphan sweep chain step after permanent failure",
      );
    }
  });

  logger.info("orphan sweep chain worker registered");
  return worker;
};
