// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";

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
import fastq from "fastq";

import { prisma } from "~/server/db";
import type {
  DeduplicationConfig,
  EventSourcedQueueProcessor,
} from "~/server/event-sourcing/queues";
import type { EventSourcingService } from "~/server/event-sourcing/services/eventSourcingService";

import { runIngestionPullForSource } from "./pullerWorker";

const logger = createLogger("langwatch:governance:ingestionPullScheduler");

/** Event-sourcing job name for the recurring pull. */
const INGESTION_PULL_JOB = "ingestionPull";

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
 * on this node. The re-arm is deliberately *outside* it (re-arming is cheap and
 * must never be starved by a saturated pull pool); only the pull body — the
 * upstream fetch + ClickHouse write — is gated.
 */
const pullBulkhead = fastq.promise<unknown, string, void>(
  (ingestionSourceId: string) => runIngestionPullForSource({ ingestionSourceId }),
  PULL_CONCURRENCY_LIMIT,
);

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
 * How long a tick that found the pull bulkhead saturated waits before its
 * re-staged attempt dispatches again: base + up to `JITTER` of spread so a
 * burst of deferred sources doesn't re-dispatch as a single thundering herd.
 */
const SATURATION_DEFER_BASE_MS = 2_000;
const SATURATION_DEFER_JITTER_MS = 3_000;

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
  shouldReplace: boolean,
): DeduplicationConfig<IngestionPullPayload> {
  return {
    makeId: (payload) => payload.ingestionSourceId,
    ttlMs: delayMs + DEDUP_BUFFER_MS,
    // A normal seed squashes without disturbing the pending schedule. An
    // explicit schedule change updates both the staged payload and its score;
    // GroupQueue uses `extend` to move the dispatch score on a dedup hit.
    extend: shouldReplace,
    replace: shouldReplace,
  };
}

async function stagePull({
  facade,
  source,
  nowMs,
  shouldReplace = false,
}: {
  facade: PullJobFacade;
  source: SchedulableSource;
  nowMs: number;
  shouldReplace?: boolean;
}): Promise<void> {
  const delayMs = computeNextDelayMs(source.pullSchedule, nowMs);
  await facade.send(
    { ingestionSourceId: source.id, tenantId: source.organizationId },
    {
      delay: delayMs,
      deduplication: dedupForSource(delayMs, shouldReplace),
    },
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

  // Re-arm the next pull BEFORE running this one (crash-safe recurrence). The
  // failure is intentionally NOT swallowed: if the re-arm write fails, letting
  // it escape fails this job so the GroupQueue retry path re-runs it (re-arm +
  // pull) with backoff. Swallowing it would ack a tick with no successor
  // staged, silently ending the recurrence until a worker restart — exactly the
  // ingestion-gap failure this migration exists to avoid. The pull body is left
  // unreached until the successor is staged.
  const facade = pullJobFacade;
  if (facade) {
    await stagePull({
      facade,
      source: {
        id: source.id,
        pullSchedule: source.pullSchedule,
        organizationId: source.organizationId,
      },
      nowMs: Date.now(),
    });
  }

  // Gate the pull body through the bounded bulkhead so a burst of same-minute
  // sources cannot fan out into unbounded upstream + ClickHouse load.
  //
  // Parking on `push` here would hold a global GroupQueue worker slot while
  // waiting, letting a due-pull burst crowd out unrelated event-sourcing work.
  // When the bulkhead is saturated, defer instead: re-stage this source's pull
  // a few seconds out (replace-dedup moves the successor staged above, so the
  // source still has exactly one pending job) and ack the tick. Deferring
  // rather than throwing matters — saturation is ordinary backpressure, and a
  // thrown error would spend the queue's bounded retry budget on it; enough
  // consecutive saturated attempts would exhaust the budget and park the
  // source's group in the operator-managed blocked set, silently ending the
  // recurrence. Acking is safe because the successor is already staged.
  const bulkheadRunning = pullBulkhead.running();
  if (facade && bulkheadRunning >= PULL_CONCURRENCY_LIMIT) {
    const deferMs =
      SATURATION_DEFER_BASE_MS +
      Math.floor(Math.random() * SATURATION_DEFER_JITTER_MS);
    logger.debug(
      { ingestionSourceId: source.id, bulkheadRunning, deferMs },
      "pull bulkhead saturated; deferring this tick without spending the retry budget",
    );
    await facade.send(
      { ingestionSourceId: source.id, tenantId: source.organizationId },
      {
        delay: deferMs,
        deduplication: dedupForSource(deferMs, true),
      },
    );
    return;
  }

  await pullBulkhead.push(source.id);
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
 * Seeds or reschedules a single source immediately (e.g. after create or a
 * schedule update) without waiting for a worker restart. No-op when the source
 * has no schedule or event sourcing is disabled.
 */
export async function armIngestionPullForSource({
  source,
  shouldReplace = false,
}: {
  source: {
    id: string;
    pullSchedule: string | null;
    organizationId: string;
  };
  shouldReplace?: boolean;
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
      shouldReplace,
    });
  } catch (error) {
    logger.error(
      {
        ingestionSourceId: source.id,
        pullSchedule: source.pullSchedule,
        error,
      },
      "failed to arm ingestion pull for source",
    );
  }
}
