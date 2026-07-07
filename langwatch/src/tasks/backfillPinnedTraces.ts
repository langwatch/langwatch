import { prisma } from "../server/db";
import { getApp } from "~/server/app-layer/app";
import { initializeDefaultApp } from "~/server/app-layer/presets";
import { createLogger } from "../utils/logger/server";

const logger = createLogger("langwatch:tasks:backfillPinnedTraces");

/**
 * One-time backfill that projects the legacy `PinnedTrace` Postgres rows onto
 * the event-sourced `trace_summaries` pin columns, via the `pinTrace` command.
 * Run once when deploying the pinned-traces refactor so pins created before the
 * cutover keep showing (Pin button, `getPin`, the "Pinned" list facet) instead
 * of silently reading as unpinned.
 *
 * Idempotent / re-runnable: each row is dispatched with the row's original
 * `createdAt` as `occurredAt`, so the command's idempotencyKey and jobId
 * (`${tenant}:${trace}:pin_trace:${source}:${occurredAt}`) are stable across
 * runs — the outbox and the fold's `deduplicateEvents` collapse repeats.
 *
 * Dispatches the raw command rather than `dataRetention.pinning.pin/autoPin`
 * on purpose: those stamp `occurredAt = Date.now()`, which would mint a fresh
 * key every run and break re-run idempotency.
 */
export default async function execute() {
  initializeDefaultApp();

  const pins = await prisma.pinnedTrace.findMany({
    select: {
      projectId: true,
      traceId: true,
      source: true,
      reason: true,
      userId: true,
      createdAt: true,
    },
  });

  logger.info({ count: pins.length }, "Found pinned traces to backfill");

  const app = getApp();
  let migrated = 0;

  for (const pin of pins) {
    try {
      await app.traces.pinTrace({
        tenantId: pin.projectId,
        traceId: pin.traceId,
        source: pin.source === "share" ? "share" : "manual",
        reason: pin.reason ?? null,
        pinnedByUserId: pin.userId ?? null,
        occurredAt: pin.createdAt.getTime(),
      });
      migrated++;
      if (migrated % 100 === 0) {
        logger.info({ migrated }, "Backfill progress");
      }
    } catch (error) {
      logger.error(
        { error, projectId: pin.projectId, traceId: pin.traceId },
        "Failed to backfill pinned trace",
      );
    }
  }

  logger.info(
    { migrated, total: pins.length },
    "Finished backfilling pinned traces to ClickHouse",
  );
}
