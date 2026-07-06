import type { PrismaClient } from "@prisma/client";
import { Cluster, type Redis } from "ioredis";
import { env } from "~/env.mjs";
import { handleSendEmail } from "~/pages/api/cron/triggers/actions/sendEmail";
import { handleSendSlackMessage } from "~/pages/api/cron/triggers/actions/sendSlackMessage";
import { createOrUpdateQueueItems } from "~/server/api/routers/annotation";
import { createManyDatasetRecords } from "~/server/api/routers/datasetRecord.utils";
import { getProtectionsForProject } from "~/server/api/utils";
import { getAnalyticsService } from "~/server/app-layer/analytics";
import type { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import type { TraceSummaryRepository } from "~/server/app-layer/traces/repositories/trace-summary.repository";
import type { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { TraceReadDerivationService } from "~/server/app-layer/traces/trace-read-derivation.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { EmailSuppressionService } from "~/server/app-layer/triggers/emailSuppression.service";
import {
  evaluateGraphTrigger,
  type GraphTriggerEvaluationDeps,
} from "~/server/app-layer/triggers/graph-trigger-evaluation.service";
import { PrismaGraphTriggerSentRepository } from "~/server/app-layer/triggers/repositories/trigger.prisma.repository";
import type { TriggerService } from "~/server/app-layer/triggers/trigger.service";
import { dispatchGraphAlertAction } from "~/server/event-sourcing/pipelines/shared/graphAlertActionDispatch";
import { sendRenderedTriggerEmail } from "~/server/mailer/triggerEmail";
import { TraceService } from "~/server/traces/trace.service";
import { sendRenderedSlackMessage } from "~/server/triggers/sendSlackWebhook";
import { TraceSummaryStore } from "../pipelines/trace-processing/projections/traceSummary.store";
import type { FoldProjectionStore } from "../projections/foldProjection.types";
import { RedisCachedFoldStore } from "../projections/redisCachedFoldStore";
import type { EventSourcedQueueProcessor } from "../queues/queue.types";
import { createOutboxDispatcher } from "./dispatcher";
import {
  consumeEmailCapSlot,
  consumeTenantEmailCapSlot,
} from "./emailHourlyCap";
import {
  type CadenceStagePayload,
  type GraphEvalStagePayload,
  type SettleStagePayload,
  settleDedupId,
} from "./payload";
import { PgOutboxAuditAdapter } from "./pgAuditAdapter";

/**
 * Outbox runtime — dispatcher + audit adapter + an attachQueue/enqueueSettle
 * pair the consumer wires up after the queue is constructed. The runtime
 * does NOT own its own queue.
 *
 * ADR-030 revision (third pass, 2026-06-02): the outbox no longer
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
  /** Producer entry point for the trigger reactors (both notify and
   *  persist classes — ADR-035). Sends a settle payload onto the attached
   *  queue with the per-trigger debounce TTL as the Debounce Mode
   *  override. */
  enqueueSettle(
    payload: SettleStagePayload,
    options: { ttlMs: number },
  ): Promise<void>;
  /**
   * Producer entry point for custom-graph threshold evaluations
   * (ADR-034 Phase 5). Same queue, single-stage payload. `makeDedupId`
   * is the caller-supplied dedup key — `graphEvalDedupId(...)` for
   * reactor-sourced enqueues, with a `:hb` suffix for heartbeat-sourced
   * enqueues so the two sources collapse SEPARATELY (real-time fires
   * even when a heartbeat is pending, and vice versa).
   */
  enqueueGraphEval(
    payload: GraphEvalStagePayload,
    options: { ttlMs: number; makeDedupId: string },
  ): Promise<void>;
}

export function buildOutboxRuntime({
  prisma,
  redis,
  triggers,
  emailSuppressions,
  projects,
  evaluations,
  traces,
  traceSummaryRepository,
}: {
  prisma: PrismaClient;
  redis: Redis | Cluster | null;
  triggers: TriggerService;
  emailSuppressions: EmailSuppressionService;
  projects: ProjectService;
  evaluations: { runs: EvaluationRunService };
  traces: { spans: SpanStorageService };
  traceSummaryRepository: TraceSummaryRepository;
}): OutboxRuntime {
  const auditAdapter = new PgOutboxAuditAdapter(prisma);

  // dispatch5015-003: fail loud if BASE_HOST is missing. Every graph-alert
  // and trace-alert dispatch interpolates baseHost into deep links
  // (project.url, graph.url, editUrl, unsubscribe URL). An empty baseHost
  // silently produces broken links for customers — detect at composition-root
  // rather than a warn buried in a hot path.
  const baseHost = env.BASE_HOST;
  if (!baseHost) {
    throw new Error(
      "BASE_HOST is unset — the outbox runtime cannot render deep links (email + Slack alert templates interpolate baseHost). Set env.BASE_HOST before booting the worker.",
    );
  }

  // Shared trace fold store — settle stage cross-reads it to drive the
  // post-settle filter check against fresh state.
  // RedisCachedFoldStore takes a standalone `Redis` client; a Cluster
  // client falls back to the uncached store rather than being cast
  // through and failing at runtime on an API mismatch.
  const traceSummaryStore: FoldProjectionStore<TraceSummaryData> =
    redis && !(redis instanceof Cluster)
      ? new RedisCachedFoldStore(
          new TraceSummaryStore(traceSummaryRepository),
          redis,
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

  // Constructed once — `traceById` runs per trace per digest on the
  // dispatch hot path, so per-call construction and per-call protections
  // queries are pure waste. Concurrent lookups within one dispatch's
  // Promise.all share a single in-flight protections query per project;
  // the entry is dropped once settled so protections aren't cached stale
  // across dispatch calls.
  const traceService = TraceService.create(prisma);
  const protectionsInFlight = new Map<
    string,
    ReturnType<typeof getProtectionsForProject>
  >();
  const getProtectionsDeduped = (projectId: string) => {
    let promise = protectionsInFlight.get(projectId);
    if (!promise) {
      promise = getProtectionsForProject(prisma, { projectId }).finally(() => {
        protectionsInFlight.delete(projectId);
      });
      protectionsInFlight.set(projectId, promise);
    }
    return promise;
  };

  // ADR-034 Phase 5/8.1: shared evaluator deps for graphEval-stage
  // payloads. Constructed lazily once (no per-tick allocation). The
  // notifier dispatches via the Liquid pipeline (`dispatchGraphAlertAction`)
  // so per-trigger custom templates and the alert-default Liquid
  // templates both apply — the cron's `handleSendEmail` /
  // `handleSendSlackMessage` are NOT used here (they stay around for
  // un-flagged projects that still ride the cron). Sender signatures
  // (`sendRenderedTriggerEmail` / `sendRenderedSlackMessage`) are
  // unchanged. The TriggerSent repo mirrors the cron's dedup pattern
  // exactly.
  const graphTriggerSentRepo = new PrismaGraphTriggerSentRepository(prisma);
  const graphTriggerEvalDeps: GraphTriggerEvaluationDeps = {
    loadTrigger: async ({ triggerId, projectId }) =>
      prisma.trigger.findUnique({ where: { id: triggerId, projectId } }),
    loadCustomGraph: async ({ customGraphId, projectId }) =>
      prisma.customGraph.findUnique({
        where: { id: customGraphId, projectId },
      }),
    loadProject: async (projectId) =>
      prisma.project.findUnique({ where: { id: projectId } }),
    getTimeseries: async (input) =>
      getAnalyticsService(prisma).getTimeseries(input),
    triggerSent: graphTriggerSentRepo,
    updateLastRunAt: async ({ triggerId, projectId }) =>
      triggers.updateLastRunAt(triggerId, projectId),
    notifier: {
      dispatch: async (input) =>
        dispatchGraphAlertAction({
          deps: {
            sendEmail: sendRenderedTriggerEmail,
            sendSlack: sendRenderedSlackMessage,
            // ADR-031: honour the same email suppression list the cron path
            // does, so one-click unsubscribes are respected on the
            // event-sourced graph-alert path too.
            filterSuppressedRecipients: ({ projectId, triggerId, emails }) =>
              emailSuppressions.filterSuppressed({
                projectId,
                triggerId,
                emails,
              }),
          },
          input,
        }),
    },
    baseHost,
    now: () => new Date(),
  };

  const dispatcher = createOutboxDispatcher({
    triggers,
    projects,
    baseHost,
    traceSummaryStore,
    evaluationRuns: evaluations.runs,
    deriveEvents: (params) => traceReadDerivation.deriveEvents(params),
    // ADR-031: per-trigger hourly email cap, bound from env. The slot
    // consumer reads the shared Redis connection internally.
    emailHourlyCap: env.TRIGGER_EMAIL_HOURLY_CAP,
    consumeEmailCapSlot: ({ projectId, triggerId, now, dedupKey }) =>
      consumeEmailCapSlot({
        projectId,
        triggerId,
        now,
        cap: env.TRIGGER_EMAIL_HOURLY_CAP,
        // ADR-031: the dispatcher's stable per-dispatch dedupKey gates the cap
        // INCR so an outbox retry of the same digest doesn't burn a second slot.
        dedupKey,
      }),
    // ADR-031: per-project daily cap (backstop above the hourly cap), bound
    // from env. Counts recipients; the cap consumer reads the shared Redis
    // connection internally. `cap` is passed through from the dispatcher.
    tenantDailyCap: env.TRIGGER_EMAIL_TENANT_DAILY_CAP,
    consumeTenantEmailCapSlot: ({
      projectId,
      now,
      cap,
      recipientCount,
      dedupKey,
    }) =>
      consumeTenantEmailCapSlot({
        projectId,
        now,
        cap,
        recipientCount,
        dedupKey,
      }),
    filterSuppressedEmails: ({ projectId, triggerId, emails }) =>
      emailSuppressions.filterSuppressed({ projectId, triggerId, emails }),
    evaluateGraphTrigger: async (params) => {
      await evaluateGraphTrigger({
        deps: graphTriggerEvalDeps,
        triggerId: params.triggerId,
        projectId: params.projectId,
        reason: params.reason,
      });
    },
    traceById: async (projectId, traceId) => {
      const protections = await getProtectionsDeduped(projectId);
      return traceService.getById(projectId, traceId, protections);
    },
    // ADR-035: persist-class side-effect sinks for the cadence stage's
    // `dispatchTriggerAction`. Same wiring the inline reactor used before
    // persist moved onto the outbox (see PipelineRegistry).
    addToAnnotationQueue: async (params) => {
      await createOrUpdateQueueItems({ ...params, prisma });
    },
    addToDataset: async (params) => {
      await createManyDatasetRecords(params);
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
    async enqueueGraphEval(payload, { ttlMs, makeDedupId }) {
      if (!queueHolder.current) {
        throw new Error(
          "Outbox runtime queue not attached — enqueueGraphEval called before attachQueue",
        );
      }
      // Debounce Mode collapses repeat `(triggerId, projectId)` sends
      // within the TTL. The handler is idempotent under repeated calls
      // — `TriggerSent` is the at-most-once gate — so collapsing is the
      // right behaviour. The 5s TTL the reactor passes here is the
      // per-event debounce window the Phase 5 spec locks.
      await queueHolder.current.send(payload, {
        deduplication: {
          makeId: () => makeDedupId,
          ttlMs,
        },
      });
    },
  };
}
