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

/**
 * The chain's self-perpetuating link, extracted so it can be unit-tested
 * without standing up a BullMQ Worker. Re-enqueue MUST happen AFTER the
 * previous job has transitioned out of `active` AND been removed
 * (`removeOnComplete: true`); otherwise the same jobId would still be
 * resident and the new `add()` would dedup into a no-op, stalling the
 * chain after one step.
 */
export async function handleChainStepCompleted(
  job: Pick<
    Job<OrphanSweepChainJob, OrphanSweepChainOutcome, string>,
    "data"
  > | undefined,
  outcome: OrphanSweepChainOutcome | undefined,
): Promise<void> {
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

  // The chain's only re-enqueue point: a successful step's completion. A
  // permanently-failed job (below) does NOT re-enqueue — transient sweep
  // errors are already swallowed inside the worker function so the chain
  // continues, and a job hitting permanent failure means something deeper
  // than a flaky sweep. Stalling until the next ingest re-seeds matches
  // the cold-start tolerance we already accept.
  worker.on("completed", (job, returnValue) =>
    handleChainStepCompleted(
      job,
      returnValue as OrphanSweepChainOutcome | undefined,
    ),
  );

  // Permanent failure: log + capture, but do NOT silently re-arm the
  // chain. The next ingest for this tenant re-seeds it; in the meantime
  // the surfaced error is the signal that something needs attention.
  worker.on("failed", async (job, err) => {
    logger.error(
      { jobId: job?.id, tenantId: job?.data?.tenantId, error: err.message },
      "orphan sweep chain step failed permanently; chain stalls until next ingest re-seeds",
    );
    getJobProcessingCounter("orphan_sweep_chain", "failed").inc();
    await withScope((scope) => {
      scope.setTag?.("worker", "orphanSweepChain");
      scope.setExtra?.("job", job?.data);
      captureException(err);
    });
  });

  logger.info("orphan sweep chain worker registered");
  return worker;
};
