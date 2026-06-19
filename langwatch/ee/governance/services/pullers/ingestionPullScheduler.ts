// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Event-sourced scheduler for pull-mode ingestion sources.
 *
 * Recurrence with no BullMQ and no Linux cron: the source's `pullSchedule`
 * cron string is parsed in-process (cron-parser) to compute the next fire
 * time, and a self-re-arming job on the event-sourcing global queue fires the
 * pull at that moment.
 *
 *   - `registerIngestionPullJob` registers the `ingestionPull` job once during
 *     event-sourcing setup. Its `process` re-arms the NEXT pull (at the cron's
 *     next fire time) BEFORE running the current pull, so a crash mid-pull
 *     still leaves the next pull scheduled.
 *   - `seedIngestionPullers` stages one pull per active pull-mode source at
 *     worker start. Idempotent via per-source dedup, so restarts and duplicate
 *     calls never pile up; it is also the crash-recovery net for the re-arm
 *     chain.
 *   - `armIngestionPullForSource` seeds a single source immediately on create,
 *     so a new schedule starts without waiting for a worker restart.
 *
 * Per-source group serialization (group key = source id) guarantees two pulls
 * for the same source never overlap.
 *
 * Spec: specs/ai-governance/puller-framework/event-sourced-scheduling.feature
 */
import { parseExpression } from "cron-parser";

import { prisma } from "~/server/db";
import type {
  DeduplicationConfig,
  EventSourcedQueueProcessor,
} from "~/server/event-sourcing/queues";
import type { EventSourcingService } from "~/server/event-sourcing/services/eventSourcingService";
import { createLogger } from "~/utils/logger/server";

import { runIngestionPullForSource } from "./pullerWorker";

const logger = createLogger("langwatch:governance:ingestionPullScheduler");

/** Event-sourcing job name for the recurring pull. */
const INGESTION_PULL_JOB = "ingestionPull";

/**
 * Dedup TTL is the wait until the next fire plus a buffer: long enough that a
 * duplicate seed (a second worker boot while a pull is still pending) squashes
 * into the pending job, and self-expiring afterwards. A dispatched job's dedup
 * key goes stale the moment it dispatches (the staging Lua cleans it on the
 * next send for that source), so the re-arm chain is never blocked by it
 * regardless of TTL.
 */
const DEDUP_BUFFER_MS = 60_000;

/** Floor so a cron expression that resolves to "now" never busy-loops. */
const MIN_DELAY_MS = 1_000;

/**
 * Payload for an `ingestionPull` job. `tenantId` (the org id) drives the
 * event-sourcing tenant fairness + per-source group key; `ingestionSourceId`
 * is the row the pull targets.
 */
export type IngestionPullPayload = {
  ingestionSourceId: string;
  tenantId: string;
};

type PullJobFacade = EventSourcedQueueProcessor<IngestionPullPayload>;

/** A schedulable source: enough to compute the next fire and address the job. */
type SchedulableSource = {
  id: string;
  pullSchedule: string;
  organizationId: string;
};

/**
 * Set once during `registerIngestionPullJob`. Shared by the seeder and the
 * create-time arm so they enqueue onto the same registered job. Null when event
 * sourcing is disabled (the job never registers) — callers then no-op.
 */
let pullJobFacade: PullJobFacade | null = null;

/**
 * Next fire delay (ms from `nowMs`) for a cron string, parsed in-process with
 * cron-parser. Throws on an invalid cron string (callers log + skip).
 */
export function computeNextDelayMs(cron: string, nowMs: number): number {
  const nextFireMs = parseExpression(cron, { currentDate: new Date(nowMs) })
    .next()
    .toDate()
    .getTime();
  return Math.max(MIN_DELAY_MS, nextFireMs - nowMs);
}

function dedupForSource(
  delayMs: number,
): DeduplicationConfig<IngestionPullPayload> {
  return {
    makeId: (payload) => payload.ingestionSourceId,
    ttlMs: delayMs + DEDUP_BUFFER_MS,
    // Squash a duplicate seed without disturbing the pending job's schedule.
    extend: false,
    replace: false,
  };
}

async function stagePull({
  facade,
  source,
  nowMs,
}: {
  facade: PullJobFacade;
  source: SchedulableSource;
  nowMs: number;
}): Promise<void> {
  const delayMs = computeNextDelayMs(source.pullSchedule, nowMs);
  await facade.send(
    { ingestionSourceId: source.id, tenantId: source.organizationId },
    { delay: delayMs, deduplication: dedupForSource(delayMs) },
  );
}

/**
 * Registers the recurring `ingestionPull` job on the event-sourcing global
 * queue. Call once during event-sourcing setup. Returns null when event
 * sourcing is disabled.
 */
export function registerIngestionPullJob(
  service: Pick<EventSourcingService, "registerJob">,
): PullJobFacade | null {
  const facade = service.registerJob<IngestionPullPayload>({
    name: INGESTION_PULL_JOB,
    // One group per source: the queue serializes a source's pulls, so two pulls
    // for the same source never overlap.
    groupKeyFn: (payload) => payload.ingestionSourceId,
    // Score = send time, so `dispatchAfter = now + delay` is the absolute next
    // fire. (The default scoreFn reads payload.occurredAt and would resolve to
    // epoch+delay, firing immediately.)
    scoreFn: () => Date.now(),
    process: processIngestionPull,
  });
  pullJobFacade = facade;
  return facade;
}

/**
 * Runs one scheduled pull and re-arms the next. The re-arm happens FIRST so a
 * crash during the pull body still leaves the next pull scheduled. An archived
 * or no-longer-active source stops the recurrence (no re-arm, no pull).
 */
async function processIngestionPull(
  payload: IngestionPullPayload,
): Promise<void> {
  const source = await prisma.ingestionSource.findUnique({
    where: { id: payload.ingestionSourceId },
    select: {
      id: true,
      pullSchedule: true,
      organizationId: true,
      archivedAt: true,
      status: true,
    },
  });

  if (
    !source ||
    source.archivedAt !== null ||
    !source.pullSchedule ||
    (source.status !== "active" && source.status !== "awaiting_first_event")
  ) {
    logger.info(
      { ingestionSourceId: payload.ingestionSourceId },
      "ingestion source not schedulable; stopping pull recurrence",
    );
    return;
  }

  // Re-arm the next pull before running this one (crash-safe recurrence).
  const facade = pullJobFacade;
  if (facade) {
    try {
      await stagePull({
        facade,
        source: {
          id: source.id,
          pullSchedule: source.pullSchedule,
          organizationId: source.organizationId,
        },
        nowMs: Date.now(),
      });
    } catch (error) {
      logger.error(
        {
          ingestionSourceId: source.id,
          pullSchedule: source.pullSchedule,
          error,
        },
        "failed to re-arm next ingestion pull",
      );
    }
  }

  await runIngestionPullForSource({ ingestionSourceId: source.id });
}

/**
 * Stages one pull per active pull-mode source. Idempotent (per-source dedup),
 * so worker restarts and duplicate calls never pile up. Also the crash-recovery
 * net for the re-arm chain: a source whose chain was interrupted is re-seeded
 * here on the next boot.
 */
export async function seedIngestionPullers(): Promise<void> {
  const facade = pullJobFacade;
  if (!facade) {
    logger.info("event-sourcing pull job not registered; skipping seed");
    return;
  }

  let sources: {
    id: string;
    pullSchedule: string | null;
    organizationId: string;
  }[];
  try {
    sources = await prisma.ingestionSource.findMany({
      where: {
        pullSchedule: { not: null },
        archivedAt: null,
        status: { in: ["active", "awaiting_first_event"] },
      },
      select: { id: true, pullSchedule: true, organizationId: true },
    });
  } catch (error) {
    logger.error({ error }, "failed to enumerate sources for pull seeding");
    return;
  }

  const nowMs = Date.now();
  let seeded = 0;
  for (const source of sources) {
    if (!source.pullSchedule) continue;
    try {
      await stagePull({
        facade,
        source: {
          id: source.id,
          pullSchedule: source.pullSchedule,
          organizationId: source.organizationId,
        },
        nowMs,
      });
      seeded += 1;
    } catch (error) {
      logger.error(
        {
          ingestionSourceId: source.id,
          pullSchedule: source.pullSchedule,
          error,
        },
        "failed to seed ingestion pull",
      );
    }
  }

  logger.info(
    { seeded, candidates: sources.length },
    "ingestion pullers seeded onto the event-sourcing queue",
  );
}

/**
 * Seeds a single source immediately (e.g. right after create) so a new schedule
 * starts without waiting for a worker restart. No-op when the source has no
 * schedule or event sourcing is disabled.
 */
export async function armIngestionPullForSource(source: {
  id: string;
  pullSchedule: string | null;
  organizationId: string;
}): Promise<void> {
  const facade = pullJobFacade;
  if (!facade || !source.pullSchedule) return;
  try {
    await stagePull({
      facade,
      source: {
        id: source.id,
        pullSchedule: source.pullSchedule,
        organizationId: source.organizationId,
      },
      nowMs: Date.now(),
    });
  } catch (error) {
    logger.error(
      {
        ingestionSourceId: source.id,
        pullSchedule: source.pullSchedule,
        error,
      },
      "failed to arm ingestion pull for new source",
    );
  }
}
