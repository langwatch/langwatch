/**
 * BullMQ worker driving the PullerAdapter framework.
 *
 * Per scheduled tick:
 *   1. Load IngestionSource by id (must be active + in pull mode)
 *   2. Resolve adapter from `pullConfig.adapter` via the registry
 *   3. Read `pollerCursor` from the IngestionSource row
 *   4. Resolve credentials (placeholder — wired into the existing
 *      ingestion-source secret store; for the framework demo, credentials
 *      flow through `parserConfig.credentials`)
 *   5. Call `adapter.runOnce({ cursor, credentials, context })`
 *   6. Persist new cursor on success, increment errorCount on failure
 *   7. Hand off `events` to the trace store ingest path (TODO: wire
 *      to OCSF event sink — left as a follow-up to keep this slice
 *      focused on the framework + scheduling. The reactor at
 *      governanceOcsfEventsSync.reactor.ts already understands the
 *      payload shape; the adapter's NormalizedPullEvent maps cleanly
 *      onto its input.)
 *
 * This worker is the source-agnostic dispatcher — it does NOT contain
 * any per-source logic. New sources arrive by registering an adapter
 * in `pullers/index.ts` and pointing IngestionSource.pullConfig at it.
 *
 * Spec: specs/ai-governance/puller-framework/puller-adapter-contract.feature
 */
import { type Job, Worker } from "bullmq";
import { BullMQOtel } from "bullmq-otel";

import { env } from "~/env.mjs";
import type { IngestionPullerJob } from "~/server/background/types";
import { withJobContext } from "~/server/context/asyncContext";
import { prisma } from "~/server/db";
import { connection } from "~/server/redis";
import { createLogger } from "~/utils/logger/server";
import {
  captureException,
  withScope,
} from "~/utils/posthogErrorCapture";
import { PULLER_QUEUE } from "~/server/background/queues/constants";

import {
  pullerAdapterRegistry,
  registerBuiltInPullers,
  type PullResult,
} from "./index";

const logger = createLogger("langwatch:workers:ingestionPuller");

// Soft per-job deadline. The scheduled cadence is the primary control
// — long-running pulls just defer follow-on work to the next tick.
const PER_JOB_DEADLINE_MS = 5 * 60 * 1000;

export async function runIngestionPullerJob(
  job: Job<IngestionPullerJob, void, string>,
): Promise<void> {
  registerBuiltInPullers();

  const { ingestionSourceId } = job.data;
  logger.info({ jobId: job.id, ingestionSourceId }, "puller job start");

  const source = await prisma.ingestionSource.findUnique({
    where: { id: ingestionSourceId },
  });
  if (!source) {
    logger.warn({ ingestionSourceId }, "IngestionSource not found, skipping");
    return;
  }
  if (source.status !== "active" && source.status !== "awaiting_first_event") {
    logger.info(
      { ingestionSourceId, status: source.status },
      "IngestionSource not active, skipping",
    );
    return;
  }

  const pullConfig = (source.parserConfig ?? {}) as Record<string, unknown>;
  const adapterId = pullConfig.adapter;
  if (typeof adapterId !== "string") {
    logger.warn(
      { ingestionSourceId },
      "IngestionSource has no pullConfig.adapter; not a pull-mode source",
    );
    return;
  }
  const adapter = pullerAdapterRegistry.get(adapterId);
  if (!adapter) {
    logger.error(
      { ingestionSourceId, adapterId },
      "Unknown adapter id — refusing to dispatch",
    );
    await prisma.ingestionSource.update({
      where: { id: ingestionSourceId },
      data: { errorCount: { increment: 1 } },
    });
    return;
  }

  let validatedConfig: unknown;
  try {
    validatedConfig = adapter.validateConfig(pullConfig);
  } catch (error) {
    logger.error(
      { ingestionSourceId, adapterId, error },
      "pullConfig validation failed",
    );
    await prisma.ingestionSource.update({
      where: { id: ingestionSourceId },
      data: { errorCount: { increment: 1 } },
    });
    return;
  }

  const credentials =
    typeof pullConfig.credentials === "object" && pullConfig.credentials !== null
      ? (pullConfig.credentials as Record<string, string>)
      : {};

  const cursor =
    typeof source.pollerCursor === "string"
      ? source.pollerCursor
      : source.pollerCursor !== null && typeof source.pollerCursor === "object"
      ? // Some adapters persist structured cursors; for now we serialize.
        JSON.stringify(source.pollerCursor)
      : null;

  let result: PullResult;
  try {
    result = await adapter.runOnce(
      {
        cursor,
        credentials,
        context: {
          organizationId: source.organizationId,
          ingestionSourceId: source.id,
        },
        deadlineMs: Date.now() + PER_JOB_DEADLINE_MS,
      },
      validatedConfig,
    );
  } catch (error) {
    logger.error(
      { ingestionSourceId, adapterId, error },
      "adapter.runOnce threw — incrementing errorCount + leaving cursor unchanged",
    );
    await withScope(async (scope) => {
      scope.setTag?.("worker", "ingestionPuller");
      scope.setExtra?.("ingestionSourceId", ingestionSourceId);
      captureException(error);
    });
    await prisma.ingestionSource.update({
      where: { id: ingestionSourceId },
      data: { errorCount: { increment: 1 } },
    });
    return;
  }

  // Hand off events to the OCSF event sink (TODO — wired in a follow-up
  // chunk). The framework guarantees the events have the
  // NormalizedPullEvent shape; downstream just maps onto the ingest
  // pipeline that already exists for push-mode sources.
  if (result.events.length > 0) {
    logger.info(
      {
        ingestionSourceId,
        adapterId,
        eventCount: result.events.length,
      },
      "puller produced events (sink wiring pending)",
    );
  }

  // Persist the new cursor + reset errorCount on success.
  await prisma.ingestionSource.update({
    where: { id: ingestionSourceId },
    data: {
      pollerCursor: result.cursor,
      errorCount: result.errorCount > 0 ? { increment: 1 } : 0,
      lastEventAt: result.events.length > 0 ? new Date() : undefined,
      status: source.status === "awaiting_first_event" && result.events.length > 0
        ? "active"
        : source.status,
    },
  });

  logger.info(
    {
      jobId: job.id,
      ingestionSourceId,
      adapterId,
      eventCount: result.events.length,
      cursor: result.cursor,
      errorCount: result.errorCount,
    },
    "puller job done",
  );
}

export const startIngestionPullerWorker = (): Worker | null => {
  if (!connection) {
    logger.info("no redis connection, skipping ingestion puller worker");
    return null;
  }
  const worker = new Worker<IngestionPullerJob, void, string>(
    PULLER_QUEUE.NAME,
    withJobContext(runIngestionPullerJob),
    {
      connection,
      concurrency: env.NODE_ENV === "test" ? 1 : 4,
      telemetry: new BullMQOtel("ingestion_puller"),
    },
  );
  worker.on("error", (error) => {
    logger.error({ error }, "ingestion puller worker error");
  });
  return worker;
};
