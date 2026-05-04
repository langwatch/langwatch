import type { ConnectionOptions } from "bullmq";
import type { IngestionPullerJob } from "~/server/background/types";

import { createLogger } from "../../../utils/logger/server";
import { prisma } from "../../db";
import { connection } from "../../redis";
import { PULLER_QUEUE } from "./constants";
import { QueueWithFallback } from "./queueWithFallback";

export { PULLER_QUEUE } from "./constants";

const logger = createLogger("langwatch:ingestionPullerQueue");

/**
 * Async fallback for the puller queue. The actual job runner lives in
 * `langwatch/ee/governance/services/pullers/pullerWorker.ts` and is
 * registered as a BullMQ Worker by `startIngestionPullerWorker()` —
 * the fallback below is only used when Redis is unavailable, which
 * shouldn't happen for governance pullers in production but keeps the
 * dev-stack resilient.
 */
export const ingestionPullerQueue = new QueueWithFallback<
  IngestionPullerJob,
  void,
  string
>(PULLER_QUEUE.NAME, async () => {}, {
  connection: connection as ConnectionOptions,
  defaultJobOptions: {
    backoff: { type: "exponential", delay: 5000 },
    attempts: 3,
    removeOnComplete: { age: 60 * 60 * 24 },
    removeOnFail: { age: 60 * 60 * 24 * 7 },
  },
});

/**
 * Pin a stable BullMQ jobId per source so re-scheduling is idempotent.
 * BullMQ deduplicates by jobId — calling `add` twice with the same id
 * is a no-op past the first call regardless of whether the worker has
 * the job in flight.
 */
function jobIdForSource(sourceId: string): string {
  return `puller_tick:${sourceId}`;
}

/**
 * Register one BullMQ repeatable job per IngestionSource that has a
 * `pullSchedule` cron expression set. Called at worker startup; safe
 * to re-run on restart (idempotent).
 *
 * Sources without a `pullSchedule` (push-mode webhook sources, or
 * pull-mode sources still being configured) are skipped — adding the
 * schedule via the admin UI / tRPC mutation re-runs this scheduler at
 * the next worker boot.
 */
export const scheduleIngestionPullers = async (): Promise<void> => {
  if (!connection) {
    logger.info(
      "no redis connection, skipping ingestion puller scheduling",
    );
    return;
  }

  let sources: { id: string; pullSchedule: string | null; status: string }[];
  try {
    sources = await prisma.ingestionSource.findMany({
      where: {
        pullSchedule: { not: null },
        archivedAt: null,
        status: { in: ["active", "awaiting_first_event"] },
      },
      select: { id: true, pullSchedule: true, status: true },
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "failed to enumerate IngestionSource rows for puller scheduling",
    );
    return;
  }

  if (sources.length === 0) {
    logger.info("no IngestionSources with pullSchedule set; nothing to schedule");
    return;
  }

  let scheduled = 0;
  for (const source of sources) {
    if (!source.pullSchedule) continue;
    try {
      await ingestionPullerQueue.add(
        PULLER_QUEUE.JOB,
        { ingestionSourceId: source.id, scheduledAt: Date.now() },
        {
          jobId: jobIdForSource(source.id),
          repeat: { pattern: source.pullSchedule },
        },
      );
      scheduled += 1;
    } catch (error) {
      logger.error(
        {
          ingestionSourceId: source.id,
          pullSchedule: source.pullSchedule,
          error: error instanceof Error ? error.message : String(error),
        },
        "failed to schedule ingestion puller job",
      );
    }
  }

  logger.info(
    { scheduledCount: scheduled, totalCandidates: sources.length },
    "ingestion puller schedules registered",
  );
};
