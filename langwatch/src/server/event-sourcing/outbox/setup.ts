import type { PrismaClient } from "@prisma/client";
import type { Cluster, Redis } from "ioredis";
import type { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import type { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import type { TraceSummaryRepository } from "~/server/app-layer/traces/repositories/trace-summary.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerService } from "~/server/app-layer/triggers/trigger.service";
import { TraceReadDerivationService } from "~/server/app-layer/traces/trace-read-derivation.service";
import { getProtectionsForProject } from "~/server/api/utils";
import { TraceService } from "~/server/traces/trace.service";
import { TraceSummaryStore } from "../pipelines/trace-processing/projections/traceSummary.store";
import type { FoldProjectionStore } from "../projections/foldProjection.types";
import { RedisCachedFoldStore } from "../projections/redisCachedFoldStore";
import type { EventSourcedQueueProcessor } from "../queues/queue.types";
import { createOutboxDispatcher } from "./dispatcher";
import {
  settleDedupId,
  type CadenceStagePayload,
  type SettleStagePayload,
} from "./payload";
import { PgOutboxAuditAdapter } from "./pgAuditAdapter";

/**
 * Outbox runtime — dispatcher + audit adapter + an attachQueue/enqueueSettle
 * pair the consumer wires up after the queue is constructed. The runtime
 * does NOT own its own queue.
 *
 * ADR-025 revision (third pass, 2026-06-02): the outbox no longer
 * constructs a `langwatch:outbox` queue. Settle and cadence payloads ride
 * the main event-sourcing queue (`event-sourcing/jobs`), routed by
 * payload discriminator (`stage`). The audit adapter is wired onto that
 * queue and gates internally on `isSettle || isCadence`, so non-outbox
 * payloads are no-ops at the adapter and the main queue's projection /
 * reactor work is unaffected.
 *
 * Trade-off captured here so reviewers see it:
 * - Win: one Redis prefix, one set of Grafana panels, one crash-recovery
 *   story. No second queue to operate.
 * - Loss: trigger dispatches and span projections share the per-tenant
 *   fairness budget. A notification storm could nibble at the projection
 *   slot budget for the same tenant (and vice versa). Bounded by
 *   `TenantRateTracker` so neither side starves catastrophically, but it
 *   is a regression in isolation guarantees vs the two-queue split.
 */
export interface OutboxRuntime {
  /** Drives settle / cadence payloads through their stage-specific
   *  handlers. Wired into the main queue's `process` and `processBatch`
   *  callbacks for payloads that satisfy `isSettle || isCadence`. */
  dispatcher: ReturnType<typeof createOutboxDispatcher>;
  /** Projects every queue lifecycle event onto `ReactorOutbox`. Gates
   *  internally on outbox-stage payloads — non-outbox queue events
   *  no-op cheaply. Wired into the main queue's `auditAdapter` slot. */
  auditAdapter: PgOutboxAuditAdapter;
  /** Wires the main queue ref into the runtime so `enqueueSettle` (and
   *  the dispatcher's internal `enqueueCadence`) can send onto it. Call
   *  this once the main queue has been constructed. */
  attachQueue(queue: EventSourcedQueueProcessor<Record<string, unknown>>): void;
  /** Producer entry point for the trigger reactors. Sends a settle
   *  payload onto the attached queue with the per-trigger debounce TTL
   *  as the Debounce Mode override. */
  enqueueSettle(
    payload: SettleStagePayload,
    options: { ttlMs: number },
  ): Promise<void>;
}

export function buildOutboxRuntime({
  prisma,
  redis,
  triggers,
  projects,
  evaluations,
  traces,
  traceSummaryRepository,
}: {
  prisma: PrismaClient;
  redis: Redis | Cluster | null;
  triggers: TriggerService;
  projects: ProjectService;
  evaluations: { runs: EvaluationRunService };
  traces: { spans: SpanStorageService };
  traceSummaryRepository: TraceSummaryRepository;
}): OutboxRuntime {
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

  // Late-bound queue ref. The dispatcher's settle-confirmed branch and
  // the public `enqueueSettle` both call into the main queue, but the
  // main queue is constructed *after* this runtime (so it can route to
  // the dispatcher). The holder breaks the cycle.
  const queueHolder: {
    current?: EventSourcedQueueProcessor<Record<string, unknown>>;
  } = {};

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
          "Outbox runtime queue not attached — enqueueCadence called before attachQueue",
        );
      }
      await queueHolder.current.send(payload, {
        delay: delayMs > 0 ? delayMs : undefined,
      });
    },
  });

  return {
    dispatcher,
    auditAdapter,
    attachQueue(queue) {
      queueHolder.current = queue;
    },
    async enqueueSettle(payload, { ttlMs }) {
      if (!queueHolder.current) {
        throw new Error(
          "Outbox runtime queue not attached — enqueueSettle called before attachQueue",
        );
      }
      // Per-trigger Debounce Mode TTL override (`Trigger.traceDebounceMs`).
      // `extend` / `replace` default to true on DeduplicationConfig, so
      // only `makeId` and `ttlMs` need to be set here.
      await queueHolder.current.send(payload, {
        deduplication: {
          makeId: () =>
            settleDedupId({
              projectId: payload.projectId,
              triggerId: payload.triggerId,
              traceId: payload.traceId,
            }),
          ttlMs,
        },
      });
    },
  };
}

