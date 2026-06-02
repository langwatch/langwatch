import type { PrismaClient } from "@prisma/client";
import type { Cluster, Redis } from "ioredis";
import type { ProcessRole } from "~/server/app-layer/config";
import type { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import type { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import type { TraceSummaryRepository } from "~/server/app-layer/traces/repositories/trace-summary.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerService } from "~/server/app-layer/triggers/trigger.service";
import { TraceReadDerivationService } from "~/server/app-layer/traces/trace-read-derivation.service";
import { getProtectionsForProject } from "~/server/api/utils";
import { TraceService } from "~/server/traces/trace.service";
import { DEFAULT_TRACE_DEBOUNCE_MS } from "~/automations/cadences";
import { TraceSummaryStore } from "../pipelines/trace-processing/projections/traceSummary.store";
import type { FoldProjectionStore } from "../projections/foldProjection.types";
import { RedisCachedFoldStore } from "../projections/redisCachedFoldStore";
import { GroupQueueProcessor } from "../queues/groupQueue/groupQueue";
import { EventSourcedQueueProcessorMemory } from "../queues/memory";
import type {
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
} from "../queues/queue.types";
import { createOutboxDispatcher } from "./dispatcher";
import {
  cadenceGroupKey,
  isSettle,
  settleDedupId,
  settleGroupKey,
  type CadenceStagePayload,
  type OutboxJob,
} from "./payload";
import { PgOutboxAuditAdapter } from "./pgAuditAdapter";

export const OUTBOX_QUEUE_NAME = "langwatch:outbox";

export interface OutboxStack {
  queue: EventSourcedQueueProcessor<OutboxJob>;
  auditAdapter: PgOutboxAuditAdapter;
}

/**
 * Composition root for the unified outbox stack (ADR-021 revision +
 * ADR-025 + ADR-030).
 *
 * One queue, two stages:
 *   - settle: per-(trigger, trace) Debounce Mode dedup; the timer
 *     elapses without new spans → process callback re-reads fold,
 *     runs filters, claims `TriggerSent`, re-enqueues as cadence.
 *   - cadence: per-trigger group, windowed `delay`; `processBatch`
 *     coalesces same-trigger jobs landing in the same wall-clock
 *     cadence boundary into one digest.
 *
 * Audit projection (PG `ReactorOutbox`) is written by the queue's
 * `auditAdapter` — onEnqueue / onLeased / onDispatched / onFailed /
 * onDead hooks fire as the queue moves jobs through their lifecycle.
 * `PgOutboxAuditAdapter` handles BOTH settle and cadence stages: settle
 * inserts a `queued` row keyed by the per-(trigger, trace) dedup key,
 * the post-settle filter check either drops the row or transitions it
 * to the cadence boundary. Operators see settle activity alongside
 * cadence activity in the same table.
 *
 * Consumer loop only runs on `processRole === "worker"`. Web can
 * still `queue.send` (the send-side is producer-only) but never
 * drains. Web should still skip calling `setupOutbox` entirely —
 * gate the call site on processRole to avoid the Redis-client cost.
 */
export function setupOutbox({
  prisma,
  redis,
  processRole,
  triggers,
  projects,
  evaluations,
  traces,
  traceSummaryRepository,
}: {
  prisma: PrismaClient;
  redis: Redis | Cluster | null;
  processRole: ProcessRole;
  triggers: TriggerService;
  projects: ProjectService;
  evaluations: { runs: EvaluationRunService };
  traces: { spans: SpanStorageService };
  traceSummaryRepository: TraceSummaryRepository;
}): OutboxStack {
  const auditAdapter = new PgOutboxAuditAdapter(prisma);

  // Shared trace fold store — settle stage cross-reads it to drive the
  // post-settle filter check against fresh state.
  const traceSummaryStore: FoldProjectionStore<TraceSummaryData> = redis
    ? new RedisCachedFoldStore(
        new TraceSummaryStore(traceSummaryRepository),
        redis as Redis,
        { keyPrefix: "trace_summaries" },
      )
    : new TraceSummaryStore(traceSummaryRepository);

  const traceReadDerivation = new TraceReadDerivationService(traces.spans);

  // Late-bound: the settle-stage process callback needs to re-enqueue
  // as cadence, but the queue handle is built _after_ the dispatcher.
  // A holder pattern lets the dispatcher reach into the constructed
  // queue without circular-import gymnastics.
  const queueHolder: { current?: EventSourcedQueueProcessor<OutboxJob> } = {};

  const dispatcher = createOutboxDispatcher({
    triggers,
    projects,
    traceSummaryStore,
    evaluationRuns: evaluations.runs,
    deriveEvents: (params) => traceReadDerivation.deriveEvents(params),
    traceById: async (projectId, traceId) => {
      const traceService = TraceService.create(prisma);
      const protections = await getProtectionsForProject(prisma, { projectId });
      return traceService.getById(projectId, traceId, protections);
    },
    enqueueCadence: async (
      payload: CadenceStagePayload,
      { delayMs }: { delayMs: number },
    ) => {
      if (!queueHolder.current) {
        throw new Error(
          "Outbox queue not yet wired — enqueueCadence called before setupOutbox returned",
        );
      }
      await queueHolder.current.send(payload, {
        delay: delayMs > 0 ? delayMs : undefined,
      });
    },
  });

  const definition: EventSourcedQueueDefinition<OutboxJob> = {
    name: OUTBOX_QUEUE_NAME,
    process: dispatcher.process,
    processBatch: dispatcher.processBatch,
    // Coalesce only cadence-stage jobs — settle is per-(trigger, trace),
    // batching it doesn't make sense.
    coalesceMaxBatch: (payload) => (isSettle(payload) ? 1 : 100),
    // Per-stage group key: per-trace for settle (so noisy traces don't
    // head-of-line block other traces), per-trigger for cadence (so
    // processBatch can coalesce a digest).
    groupKey: (payload) =>
      isSettle(payload)
        ? settleGroupKey(payload)
        : cadenceGroupKey(payload),
    deduplication: {
      // Settle stage: per-(trigger, trace) Debounce Mode (extend +
      // replace TTL on every send so the latest event wins). Cadence
      // stage uses a per-job id so it doesn't dedup across digest
      // members — the digest grouping is done by `groupKey` +
      // `coalesceMaxBatch`, not by dedup.
      makeId: (payload) =>
        isSettle(payload)
          ? settleDedupId(payload)
          : `${payload.projectId}/cadence/${payload.auditDedupKey}`,
      ttlMs: DEFAULT_TRACE_DEBOUNCE_MS,
      extend: true,
      replace: true,
    },
    auditAdapter,
  };

  const queue: EventSourcedQueueProcessor<OutboxJob> = redis
    ? new GroupQueueProcessor(definition, redis, {
        consumerEnabled: processRole === "worker",
      })
    : new EventSourcedQueueProcessorMemory(definition);

  queueHolder.current = queue;

  return { queue, auditAdapter };
}
