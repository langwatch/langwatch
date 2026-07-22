import type { PrismaClient } from "@prisma/client";
import { Cluster, type Redis } from "ioredis";
import { env } from "~/env.mjs";
import { createOrUpdateQueueItems } from "~/server/api/routers/annotation";
import { createManyDatasetRecords } from "~/server/api/routers/datasetRecord.utils";
import { getProtectionsForProject } from "~/server/api/utils";
import { getAnalyticsService } from "~/server/app-layer/analytics";
import type { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import type { ProjectServicePort } from "~/server/domain/projects/project-service.port";
import type { TraceSummaryRepository } from "~/server/event-sourcing/ports/trace-summary.repository";
import type { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { TraceReadDerivationService } from "~/server/app-layer/traces/trace-read-derivation.service";
import type { TraceSummaryData } from "~/server/domain/traces/types";
import type { EmailSuppressionService } from "~/server/app-layer/automations/emailSuppression.service";
import { TraceSummaryStore } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.store";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import { RedisCachedFoldStore } from "~/server/event-sourcing/projections/redisCachedFoldStore";
import { sendRenderedTriggerEmail } from "~/server/mailer/triggerEmail";
import { TraceService } from "~/server/traces/trace.service";
import { sendRenderedSlackMessage } from "~/server/app-layer/automations/delivery/sendSlackWebhook";
import { sendWebhook } from "~/server/app-layer/automations/delivery/sendWebhook";
import { postSlackChatMessage } from "~/server/app-layer/automations/delivery/slackWebApi";

import { WebhookDeliveryService } from "~/server/app-layer/automations/webhook-delivery.service";
import {
  evaluateGraphTrigger,
  type GraphTriggerEvaluationDeps,
  type GraphTriggerEvaluationReason,
} from "~/server/app-layer/automations/graph-trigger-evaluation.service";
import {
  decideGraphTriggerHeartbeat,
  defaultCandidateSources,
  defaultGraphTriggerHeartbeatDeps,
  type GraphTriggerSweepCandidate,
} from "~/server/app-layer/automations/graph-trigger-heartbeat";
import { AutomationCustomGraphService } from "~/server/app-layer/automations/custom-graph.service";
import { PrismaGraphTriggerSentRepository } from "~/server/app-layer/automations/repositories/trigger.prisma.repository";
import type { TriggerPort } from "~/server/domain/automations/trigger.port";
import { dispatchGraphAlertAction } from "~/server/app-layer/automations/dispatch/graphAlertActionDispatch";
import {
  consumeEmailCapSlot,
  consumeTenantEmailCapSlot,
} from "~/server/app-layer/automations/dispatch/emailCaps";
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
  decideSweepCandidates: (params: {
    now: Date;
  }) => Promise<GraphTriggerSweepCandidate[]>;
  /** ADR-040 §6: deletes delivery-log rows older than 30 days; returns the
   *  row count. Driven by the daily `webhookDeliveryPrune` scheduled process
   *  manager (the K8s CronJob path was removed). */
  pruneWebhookDeliveries: () => Promise<number>;
}

export function buildAutomationDispatchPorts({
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
  triggers: TriggerPort;
  emailSuppressions: EmailSuppressionService;
  projects: ProjectServicePort;
  evaluations: { runs: EvaluationRunService };
  traces: { spans: SpanStorageService };
  traceSummaryRepository: TraceSummaryRepository;
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
      ? new RedisCachedFoldStore(
          new TraceSummaryStore(traceSummaryRepository),
          redis,
          { keyPrefix: "trace_summaries" },
        )
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

  // ADR-034 Phase 5/8.1: shared evaluator deps. The notifier dispatches via
  // the Liquid pipeline (`dispatchGraphAlertAction`) so per-trigger custom
  // templates and the alert-default Liquid templates both apply. The
  // TriggerSent repo mirrors the legacy dedup pattern exactly.
  const graphTriggerSentRepo = new PrismaGraphTriggerSentRepository(prisma);
  // ADR-040 §6: one delivery-log writer shared by the digest dispatch and
  // the graph-alert path.
  const webhookDeliveries = WebhookDeliveryService.create(prisma);
  const recordWebhookDelivery = (
    input: Parameters<typeof webhookDeliveries.record>[0],
  ) => webhookDeliveries.record(input);
  // Graph-config loads go through the automations-owned service, not raw
  // prisma — same query shape, service/repository layering (no direct
  // prisma in composition-root closures).
  const customGraphs = AutomationCustomGraphService.create(prisma);
  const graphTriggerEvalDeps: GraphTriggerEvaluationDeps = {
    loadTrigger: async ({ triggerId, projectId }) =>
      triggers.getById({ triggerId, projectId }),
    loadCustomGraph: async ({ customGraphId, projectId }) =>
      customGraphs.getById({ customGraphId, projectId }),
    loadProject: async (projectId) => projects.getById(projectId),
    getTimeseries: async (input) => getAnalyticsService().getTimeseries(input),
    triggerSent: graphTriggerSentRepo,
    updateLastRunAt: async ({ triggerId, projectId }) =>
      triggers.updateLastRunAt(triggerId, projectId),
    notifier: {
      dispatch: async (input) =>
        dispatchGraphAlertAction({
          deps: {
            sendEmail: sendRenderedTriggerEmail,
            sendSlack: sendRenderedSlackMessage,
            sendSlackBot: postSlackChatMessage,
            sendWebhook,
            recordWebhookDelivery,
            // ADR-031: honour the same suppression list + hard caps the
            // digest path consumes; claims keyed on the fire digest so a
            // retry re-reads the count instead of burning a second slot.
            filterSuppressedRecipients: ({ projectId, triggerId, emails }) =>
              emailSuppressions.filterSuppressed({
                projectId,
                triggerId,
                emails,
              }),
            consumeEmailCapSlot: ({ projectId, triggerId, now, dedupKey }) =>
              consumeEmailCapSlot({
                projectId,
                triggerId,
                now,
                cap: env.TRIGGER_EMAIL_HOURLY_CAP,
                dedupKey,
              }),
            emailHourlyCap: env.TRIGGER_EMAIL_HOURLY_CAP,
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
            tenantDailyCap: env.TRIGGER_EMAIL_TENANT_DAILY_CAP,
            // ADR-031 per-recipient at-most-once ledger — the SAME
            // TriggerSent claim store the digest dispatch threads in.
            isRecipientSent: (params) => triggers.isSendClaimed(params),
            recordRecipientSent: async (params) => {
              await triggers.claimSend(params);
            },
          },
          input,
        }),
    },
    baseHost,
    now: () => new Date(),
  };

  const boundEvaluateGraphTrigger = async (params: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }) => {
    await evaluateGraphTrigger({
      deps: graphTriggerEvalDeps,
      triggerId: params.triggerId,
      projectId: params.projectId,
      reason: params.reason,
    });
  };

  const heartbeatDeps = defaultGraphTriggerHeartbeatDeps({ triggers, prisma });
  const heartbeatSources = defaultCandidateSources(prisma);

  const settlementDeps: TriggerSettlementDispatchDeps = {
    triggers,
    projects,
    baseHost,
    traceSummaryStore,
    evaluationRuns: evaluations.runs,
    deriveEvents: (params) => traceReadDerivation.deriveEvents(params),
    emailHourlyCap: env.TRIGGER_EMAIL_HOURLY_CAP,
    consumeEmailCapSlot: ({ projectId, triggerId, now, dedupKey }) =>
      consumeEmailCapSlot({
        projectId,
        triggerId,
        now,
        cap: env.TRIGGER_EMAIL_HOURLY_CAP,
        dedupKey,
      }),
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
    traceById: async (projectId, traceId) => {
      const protections = await getProtectionsDeduped(projectId);
      return traceService.getById(projectId, traceId, protections);
    },
    addToAnnotationQueue: async (params) => {
      await createOrUpdateQueueItems({ ...params, prisma });
    },
    addToDataset: async (params) => {
      await createManyDatasetRecords(params);
    },
    recordWebhookDelivery,
  };

  return {
    settlementDeps,
    evaluateGraphTrigger: boundEvaluateGraphTrigger,
    decideSweepCandidates: ({ now }) =>
      decideGraphTriggerHeartbeat({
        deps: heartbeatDeps,
        sources: heartbeatSources,
        now,
      }),
    pruneWebhookDeliveries: () => webhookDeliveries.pruneExpired(),
  };
}
