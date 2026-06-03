import type { ConnectionOptions } from "bullmq";

import { prisma } from "~/server/db";
import { QueueWithFallback } from "./queueWithFallback";
import { connection } from "~/server/redis";
import { createLogger } from "~/utils/logger/server";

import { PULLER_QUEUE, type IngestionPullerJob } from "./pullerWorker";

const logger = createLogger("langwatch:ingestionPullerQueue");

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

function jobIdForSource(sourceId: string): string {
  return `puller_tick:${sourceId}`;
}

/**
 * Register one BullMQ repeatable job per IngestionSource that has a
 * `pullSchedule` cron expression set. Called at worker startup; safe
 * to re-run on restart (idempotent).
 */
export const scheduleIngestionPullers = async (): Promise<void> => {
  if (!connection) {
    logger.info("no redis connection, skipping ingestion puller scheduling");
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
    logger.info(
      "no IngestionSources with pullSchedule set; nothing to schedule",
    );
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
          error: error instanceof Error ? error.message : String(error),
        },
        "failed to schedule ingestion puller",
      );
    }
  }

  logger.info({ scheduled }, "scheduled ingestion pullers");
};
