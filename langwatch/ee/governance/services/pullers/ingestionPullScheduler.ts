// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";

/**
 * Calendar-scheduled pull-mode ingestion sources (ADR-044 consumer).
 *
 * Recurrence and execution are two deliberately separate layers:
 *
 *   - WHEN a pull fires is owned by one durable `ScheduledJob` calendar row
 *     per pull-mode source (Postgres, survives Redis loss and restarts).
 *     `syncIngestionPullSchedule` / `removeIngestionPullSchedule` keep the row
 *     in step with the source's lifecycle, and `reconcileIngestionPullSchedules`
 *     repairs rows a crash between the two writes left missing (worker boot).
 *   - HOW a pull runs is owned by the event-sourcing GroupQueue:
 *     `handleIngestionPullFire` (the registered calendar handler) enqueues an
 *     `ingestionPull` job and returns, so the serial scheduler loop is never
 *     blocked by a slow pull. The job gives per-source serialization (group
 *     key = source id) and the bulkhead bounds global pull concurrency.
 *
 * Pulls are cursor-based, so a fire is a self-contained "catch up from the
 * cursor": a missed or deferred slot delays data, never loses it.
 *
 * Spec: specs/ai-governance/puller-framework/calendar-scheduled-pulls.feature
 */
import type { PrismaClient } from "@prisma/client";
import { Cron } from "croner";
import fastq from "fastq";

import { PrismaScheduledJobRepository } from "~/server/app-layer/scheduler/scheduled-job.repository";
import type { ScheduledJobFire } from "~/server/app-layer/scheduler/scheduler.types";
import { prisma as defaultPrisma } from "~/server/db";
import type {
  DeduplicationConfig,
  EventSourcedQueueProcessor,
} from "~/server/event-sourcing/queues";
import type { EventSourcingService } from "~/server/event-sourcing/services/eventSourcingService";

import { ensureHiddenGovernanceProject } from "../governanceProject.service";

import { runIngestionPullForSource } from "./pullerWorker";

const logger = createLogger("langwatch:governance:ingestionPullScheduler");

/** Calendar consumer key: `ScheduledJob.targetType` for ingestion pulls. */
export const INGESTION_PULL_TARGET_TYPE = "ingestionPull";

/** Event-sourcing job name for the pull execution. */
const INGESTION_PULL_JOB = "ingestionPull";

/**
 * Pull schedules are wall-clock polling cadences, not user-local calendars,
 * so every source's cron is evaluated in UTC.
 */
const PULL_SCHEDULE_TIMEZONE = "UTC";

/** Standard cron: minute, hour, day-of-month, month, day-of-week. */
const CRON_FIELD_COUNT = 5;

/**
 * Bounded global pull concurrency on this node. The removed BullMQ puller
 * worker ran with `concurrency: 4`; the shared event-sourcing global queue it
 * moved onto defaults to `GLOBAL_QUEUE_CONCURRENCY` (100) and the per-source
 * group key only serializes pulls *within* a source. Without a bulkhead, N
 * sources whose crons land on the same minute would fire N concurrent upstream
 * audit-log fetches and ClickHouse writes — a 25× jump over the old dedicated
 * limit that also crowds out unrelated event-sourcing work. This semaphore
 * retains the previous operational limit and bounds the external blast radius;
 * override with `GOVERNANCE_PULLER_CONCURRENCY`.
 */
export const PULL_CONCURRENCY_LIMIT = Math.max(
  1,
  Number(process.env.GOVERNANCE_PULLER_CONCURRENCY) || 4,
);

/**
 * fastq bulkhead that caps how many pull bodies run at once across all sources
 * on this node. Only the pull body — the upstream fetch + ClickHouse write —
 * is gated.
 */
const pullBulkhead = fastq.promise<unknown, string, void>(
  (ingestionSourceId: string) =>
    runIngestionPullForSource({ ingestionSourceId }),
  PULL_CONCURRENCY_LIMIT,
);

/**
 * How long a tick that found the pull bulkhead saturated waits before its
 * re-staged attempt dispatches again: base + up to `JITTER` of spread so a
 * burst of deferred sources doesn't re-dispatch as a single thundering herd.
 */
const SATURATION_DEFER_BASE_MS = 2_000;
const SATURATION_DEFER_JITTER_MS = 3_000;

/**
 * Dedup TTL for a staged pull job. Fires enqueue with no delay, so the TTL
 * only needs to cover the window in which a duplicate enqueue could happen
 * (a calendar re-fire racing an undispatched job, or a saturation deferral).
 * A dispatched job's dedup key goes stale the moment it dispatches (the
 * staging Lua cleans it on the next send for that source), so recurrence is
 * never blocked by it.
 */
const DEDUP_TTL_MS = 10 * 60_000;

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

/**
 * Set once during `registerIngestionPullJob`. Shared by the calendar fire
 * handler so it enqueues onto the same registered job. Null when event
 * sourcing is disabled (the job never registers) — callers then no-op.
 */
let pullJobFacade: PullJobFacade | null = null;

// ---------------------------------------------------------------------------
// Cron validation
// ---------------------------------------------------------------------------

/**
 * Validate a `pullSchedule` as a standard five-field cron with a reachable
 * next fire, evaluated by croner — the same evaluator the calendar scheduler
 * fires it with, so "validates" and "fires" can never disagree. Throws on
 * anything else; callers translate into their error surface.
 *
 * Six-field (seconds-resolution) expressions are rejected explicitly: croner
 * would accept them, and `* * * * * *` would poll an upstream audit-log API
 * every second.
 */
export function assertValidPullSchedule(cron: string): void {
  if (cron.trim().split(/\s+/).length !== CRON_FIELD_COUNT) {
    throw new Error(
      `pullSchedule must be a 5-field cron expression (minute hour day-of-month month day-of-week), got "${cron}"`,
    );
  }
  const next = new Cron(cron, { timezone: PULL_SCHEDULE_TIMEZONE }).nextRun();
  if (!next) {
    throw new Error(`pullSchedule "${cron}" has no reachable future fire`);
  }
}

/** Next fire instant for a valid pull schedule, strictly after `after`. */
function nextPullRunAt(cron: string, after: Date): Date {
  const next = new Cron(cron, { timezone: PULL_SCHEDULE_TIMEZONE }).nextRun(
    after,
  );
  if (!next) {
    throw new Error(
      `pullSchedule "${cron}" has no run after ${after.toISOString()}`,
    );
  }
  return next;
}

// ---------------------------------------------------------------------------
// Calendar sync (recurrence ownership)
// ---------------------------------------------------------------------------

/** A schedulable source: enough to compute the next fire and key the row. */
type SchedulableSource = {
  id: string;
  pullSchedule: string;
  organizationId: string;
};

/**
 * The `ScheduledJob` writes are project-scoped (multitenancy guard); an
 * ingestion source is org-scoped, so its calendar rows live under the org's
 * hidden governance project — the same tenant key its OCSF events land under.
 */
async function pullScheduleProjectId(
  prisma: PrismaClient,
  organizationId: string,
): Promise<string> {
  const project = await ensureHiddenGovernanceProject(prisma, organizationId);
  return project.id;
}

/**
 * Create-or-refresh the source's calendar row: one `ScheduledJob` per source
 * (`targetId` = source id), next fire computed from the cron. An upsert
 * re-activates a deactivated row, so this is also the re-enable path.
 *
 * No cross-pod scheduler wake (unlike report upserts): pull crons are
 * minute-granular and background, so the loop's poll backstop picks a new
 * row up well within one cron period — there is no "run now" UX to serve.
 */
export async function syncIngestionPullSchedule({
  source,
  prisma = defaultPrisma,
}: {
  source: SchedulableSource;
  prisma?: PrismaClient;
}): Promise<void> {
  const repo = new PrismaScheduledJobRepository(prisma);
  await repo.upsertForTarget({
    projectId: await pullScheduleProjectId(prisma, source.organizationId),
    targetType: INGESTION_PULL_TARGET_TYPE,
    targetId: source.id,
    cron: source.pullSchedule,
    timezone: PULL_SCHEDULE_TIMEZONE,
    nextRunAt: nextPullRunAt(source.pullSchedule, new Date()),
  });
}

/** Deactivate the source's calendar row so the due-scan skips it. */
export async function removeIngestionPullSchedule({
  source,
  prisma = defaultPrisma,
}: {
  source: { id: string; organizationId: string };
  prisma?: PrismaClient;
}): Promise<void> {
  const repo = new PrismaScheduledJobRepository(prisma);
  await repo.deactivateForTarget({
    projectId: await pullScheduleProjectId(prisma, source.organizationId),
    targetType: INGESTION_PULL_TARGET_TYPE,
    targetId: source.id,
  });
}

/**
 * Boot-time repair (durable self-heal): the source row and its calendar row
 * are written in two non-atomic steps, so a crash between them leaves an
 * active pull-mode source that silently never fires. This pass creates the
 * missing rows. Create-if-MISSING only — a source that already has a row
 * (active or deactivated) is left untouched, so reconciliation never
 * resurrects a schedule that disable/archive intentionally deactivated.
 */
export async function reconcileIngestionPullSchedules({
  prisma = defaultPrisma,
}: { prisma?: PrismaClient } = {}): Promise<{ repaired: number }> {
  let sources: SchedulableSource[];
  try {
    const rows = await prisma.ingestionSource.findMany({
      where: {
        pullSchedule: { not: null },
        archivedAt: null,
        status: { in: ["active", "awaiting_first_event"] },
      },
      select: { id: true, pullSchedule: true, organizationId: true },
    });
    sources = rows.filter(
      (row): row is SchedulableSource => row.pullSchedule !== null,
    );
  } catch (error) {
    logger.error({ error }, "failed to enumerate sources for pull reconcile");
    return { repaired: 0 };
  }
  if (sources.length === 0) return { repaired: 0 };

  const repo = new PrismaScheduledJobRepository(prisma);
  // One project resolution + one row-set fetch per org, not per source.
  const projectIdByOrg = new Map<string, string>();
  const scheduledTargetIdsByProject = new Map<string, Set<string>>();
  let repaired = 0;
  for (const source of sources) {
    try {
      let projectId = projectIdByOrg.get(source.organizationId);
      if (!projectId) {
        projectId = await pullScheduleProjectId(prisma, source.organizationId);
        projectIdByOrg.set(source.organizationId, projectId);
      }
      let scheduledTargetIds = scheduledTargetIdsByProject.get(projectId);
      if (!scheduledTargetIds) {
        const existing = await repo.findAllForProject({
          projectId,
          targetType: INGESTION_PULL_TARGET_TYPE,
        });
        scheduledTargetIds = new Set(existing.map((job) => job.targetId));
        scheduledTargetIdsByProject.set(projectId, scheduledTargetIds);
      }
      if (scheduledTargetIds.has(source.id)) continue;
      await syncIngestionPullSchedule({ source, prisma });
      repaired += 1;
    } catch (error) {
      logger.error(
        { ingestionSourceId: source.id, error },
        "failed to reconcile ingestion pull schedule",
      );
    }
  }

  logger.info(
    { repaired, candidates: sources.length },
    "ingestion pull calendar rows reconciled",
  );
  return { repaired };
}

// ---------------------------------------------------------------------------
// Calendar fire → event-sourcing execution
// ---------------------------------------------------------------------------

/**
 * The registered calendar handler for `INGESTION_PULL_TARGET_TYPE`. The
 * scheduler loop fires jobs serially, so this only ENQUEUES the pull onto the
 * event-sourcing GroupQueue and returns — the pull body (upstream fetch +
 * ClickHouse write) runs on the queue's workers, serialized per source.
 *
 * A fire for a source that is no longer schedulable deactivates its calendar
 * row (self-heal for lifecycle transitions that bypassed the service layer).
 */
export async function handleIngestionPullFire(
  fire: ScheduledJobFire,
  prisma: PrismaClient = defaultPrisma,
): Promise<void> {
  const source = await prisma.ingestionSource.findUnique({
    where: { id: fire.targetId },
    select: {
      id: true,
      organizationId: true,
      archivedAt: true,
      status: true,
      pullSchedule: true,
    },
  });

  if (
    !source ||
    source.archivedAt !== null ||
    !source.pullSchedule ||
    (source.status !== "active" && source.status !== "awaiting_first_event")
  ) {
    logger.info(
      { ingestionSourceId: fire.targetId },
      "ingestion source not schedulable; deactivating its calendar row",
    );
    // The fire carries the row's own coordinates, so this also covers a
    // hard-deleted source (`ScheduledJob` has no FK to the source) — without
    // it the orphaned row would re-fire every cron slot forever.
    await new PrismaScheduledJobRepository(prisma).deactivateForTarget({
      projectId: fire.projectId,
      targetType: fire.targetType,
      targetId: fire.targetId,
    });
    return;
  }

  const facade = pullJobFacade;
  if (!facade) {
    logger.warn(
      { ingestionSourceId: source.id },
      "event-sourcing pull job not registered; skipping calendar fire",
    );
    return;
  }

  await facade.send(
    { ingestionSourceId: source.id, tenantId: source.organizationId },
    { delay: 0, deduplication: pullDedup(DEDUP_TTL_MS) },
  );
}

function pullDedup(ttlMs: number): DeduplicationConfig<IngestionPullPayload> {
  return {
    makeId: (payload) => payload.ingestionSourceId,
    ttlMs,
    // Squash a duplicate enqueue without disturbing the pending job.
    extend: false,
    replace: false,
  };
}

/**
 * Registers the `ingestionPull` execution job on the event-sourcing global
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
    // Score = send time, so `dispatchAfter = now + delay` is the absolute
    // dispatch instant. (The default scoreFn reads payload.occurredAt and
    // would resolve to epoch+delay, firing immediately.)
    scoreFn: () => Date.now(),
    process: processIngestionPull,
  });
  pullJobFacade = facade;
  return facade;
}

/**
 * Runs one pull, gated through the bounded bulkhead so a burst of same-minute
 * sources cannot fan out into unbounded upstream + ClickHouse load. An
 * archived or no-longer-active source is skipped (the calendar handler is the
 * primary lifecycle gate; this re-check covers jobs already in flight when
 * the source was archived).
 *
 * Parking on `push` while saturated would hold a global GroupQueue worker
 * slot, letting a due-pull burst crowd out unrelated event-sourcing work; and
 * throwing would spend the queue's bounded retry budget on ordinary
 * backpressure — enough consecutive saturated attempts would park the
 * source's group in the operator-managed blocked set. So a saturated tick
 * re-stages itself a few jittered seconds out and acks; the calendar row
 * still owns the recurrence either way.
 */
async function processIngestionPull(
  payload: IngestionPullPayload,
): Promise<void> {
  const source = await defaultPrisma.ingestionSource.findUnique({
    where: { id: payload.ingestionSourceId },
    select: {
      id: true,
      organizationId: true,
      archivedAt: true,
      status: true,
      pullSchedule: true,
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
      "ingestion source not schedulable; skipping pull",
    );
    return;
  }

  const facade = pullJobFacade;
  if (facade && pullBulkhead.running() >= PULL_CONCURRENCY_LIMIT) {
    const deferMs =
      SATURATION_DEFER_BASE_MS +
      Math.floor(Math.random() * SATURATION_DEFER_JITTER_MS);
    logger.debug(
      { ingestionSourceId: source.id, deferMs },
      "pull bulkhead saturated; deferring this tick without spending the retry budget",
    );
    await facade.send(
      { ingestionSourceId: source.id, tenantId: source.organizationId },
      { delay: deferMs, deduplication: pullDedup(deferMs + 60_000) },
    );
    return;
  }

  await pullBulkhead.push(source.id);
}
