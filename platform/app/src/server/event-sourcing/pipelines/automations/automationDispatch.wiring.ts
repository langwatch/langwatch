import type { FoldProjectionStore } from "@langwatch/eventing";
import { RedisCachedFoldStore } from "@langwatch/eventing";
import { Cluster, type Redis } from "ioredis";
import { env } from "~/env.mjs";
import type { PrismaClient } from "~/generated/prisma/client";
import { createOrUpdateQueueItems } from "~/server/api/routers/annotation";
import type { DatasetService } from "@langwatch/dataset-contract";
import { getProtectionsForProject } from "~/server/api/utils";
import type { AnalyticsService } from "@langwatch/analytics-contract";
import {
  consumeEmailCapSlot,
  consumeTenantEmailCapSlot,
} from "~/server/app-layer/automations/dispatch/emailCaps";
import {
  consumePersistCapSlot,
  resolvePersistDailyCap,
} from "~/server/app-layer/automations/dispatch/persistCap";
import type {
  AutomationService,
  GraphTriggerEvaluationReason,
  GraphTriggerSweepCandidate,
} from "@langwatch/automation-contract";
import type { EvaluationService } from "@langwatch/evaluation-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { TraceSummaryRepository } from "~/server/app-layer/traces/repositories/trace-summary.repository";
import type { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { TraceReadDerivationService } from "~/server/app-layer/traces/trace-read-derivation.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { TraceSummaryStore } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.store";
import { TraceService } from "~/server/traces/trace.service";
import type { TriggerSettlementDispatchDeps } from "../../../event-sourcing/pipelines/automations/process-manager/triggerSettlementIntentHandlers";

/**
 * ADR-052 composition root for automation dispatch: builds the deps the
 * settlement intent handlers and the graph-alert paths need. This is the
 * legacy `buildOutboxRuntime` wiring minus queue transport — the process
 * outbox owns retry now.
 */
export interface AutomationDispatchPorts {
  settlementDeps: TriggerSettlementDispatchDeps;
  evaluateGraphTrigger: (params: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }) => Promise<void>;
  decideSweepCandidates: (params: { now: Date }) => Promise<GraphTriggerSweepCandidate[]>;
  /** ADR-040 §6: deletes delivery-log rows older than 30 days; returns the
   *  row count. Driven by the daily `webhookDeliveryPrune` scheduled process
   *  manager (the K8s CronJob path was removed). */
  pruneWebhookDeliveries: () => Promise<number>;
}

export function buildAutomationDispatchPorts({
  prisma,
  redis,
  automation,
  projects,
  evaluations,
  traces,
  traceSummaryRepository,
  analytics: _analytics,
  resolveClickHouseClient: _resolveClickHouseClient,
  dataset,
}: {
  prisma: PrismaClient;
  redis: Redis | Cluster | null;
  automation: AutomationService;
  projects: ProjectService;
  evaluations: EvaluationService;
  traces: { spans: SpanStorageService };
  traceSummaryRepository: TraceSummaryRepository;
  analytics: AnalyticsService;
  /** The composition root's ClickHouse resolver — the heartbeat's recency
   *  probe reads through it. Passed down, never imported. */
  resolveClickHouseClient: ClickHouseClientResolver;
  /** Dataset writes go through the process-owned Dataset service. */
  dataset?: DatasetService;
}): AutomationDispatchPorts {
  // Fail loud if BASE_HOST is missing: every alert dispatch interpolates it
  // into deep links; an empty baseHost silently ships broken links.
  const baseHost = env.BASE_HOST;
  if (!baseHost) {
    throw new Error(
      "BASE_HOST is unset — automation dispatch cannot render deep links (email + Slack alert templates interpolate baseHost). Set env.BASE_HOST before booting the worker.",
    );
  }

  // Shared trace fold store — dispatch re-reads it for the settle confirm.
  // RedisCachedFoldStore takes a standalone `Redis` client; a Cluster
  // client falls back to the uncached store.
  const traceSummaryStore: FoldProjectionStore<TraceSummaryData> =
    redis && !(redis instanceof Cluster)
      ? new RedisCachedFoldStore(new TraceSummaryStore(traceSummaryRepository), redis, {
          keyPrefix: "trace_summaries",
        })
      : new TraceSummaryStore(traceSummaryRepository);

  const traceReadDerivation = new TraceReadDerivationService(traces.spans);

  // Constructed once — `traceById` runs per trace per digest on the hot
  // path. Concurrent lookups within one dispatch share a single in-flight
  // protections query per project; the entry drops once settled so
  // protections aren't cached stale across dispatches.
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

  // ADR-040 §6: one delivery-log writer shared by the digest dispatch and
  // the graph-alert path.
  const recordWebhookDelivery = (
    input: Parameters<AutomationService["recordWebhookDelivery"]>[0],
  ) => automation.recordWebhookDelivery(input);
  const boundEvaluateGraphTrigger = async (params: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }) => {
    await automation.evaluateGraphTrigger(params);
  };

  const settlementDeps: TriggerSettlementDispatchDeps = {
    automation,
    projects,
    baseHost,
    traceSummaryStore,
    evaluationRuns: evaluations,
    deriveEvents: (params) => traceReadDerivation.deriveEvents(params),
    emailHourlyCap: env.TRIGGER_EMAIL_HOURLY_CAP,
    consumeEmailCapSlot: ({ projectId, triggerId, now, dedupKey }) =>
      consumeEmailCapSlot({
        projectId,
        triggerId,
        now,
        cap: env.TRIGGER_EMAIL_HOURLY_CAP,
        dedupKey,
        redis,
      }),
    tenantDailyCap: env.TRIGGER_EMAIL_TENANT_DAILY_CAP,
    consumeTenantEmailCapSlot: ({ projectId, now, cap, recipientCount, dedupKey }) =>
      consumeTenantEmailCapSlot({
        projectId,
        now,
        cap,
        recipientCount,
        dedupKey,
        redis,
      }),
    filterSuppressedEmails: ({ projectId, triggerId, emails }) =>
      automation.filterSuppressed({ projectId, triggerId, emails }),
    traceById: async (projectId, traceId) => {
      const protections = await getProtectionsDeduped(projectId);
      return traceService.getById(projectId, traceId, protections);
    },
    addToAnnotationQueue: async (params) => {
      await createOrUpdateQueueItems({ ...params, prisma });
    },
    addToDataset: async (params) => {
      if (!dataset) {
        throw new Error("Dataset service is not configured for automation dispatch");
      }
      await dataset.batchCreateRecords({
        slugOrId: params.datasetId,
        projectId: params.projectId,
        entries: params.datasetRecords,
      });
    },
    recordWebhookDelivery,
    resolvePersistDailyCap: (projectId) => resolvePersistDailyCap(projectId),
    consumePersistCapSlot: (params) => consumePersistCapSlot({ ...params, redis }),
    handlePersistCapBreach: (breach) => automation.handlePersistCapBreach(breach),
  };

  return {
    settlementDeps,
    evaluateGraphTrigger: boundEvaluateGraphTrigger,
    decideSweepCandidates: ({ now }) => automation.decideGraphTriggerHeartbeat({ now }),
    pruneWebhookDeliveries: () => automation.pruneWebhookDeliveries(),
  };
}
