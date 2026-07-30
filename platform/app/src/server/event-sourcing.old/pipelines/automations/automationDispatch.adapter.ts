import type { AnnotationService } from "~/server/annotations/annotation.service";
import type { AnalyticsService } from "~/server/app-layer/analytics";
import type { AutomationCustomGraphService } from "~/server/app-layer/automations/custom-graph.service";
import { sendRenderedSlackMessage } from "~/server/app-layer/automations/delivery/sendSlackWebhook";
import { sendWebhook } from "~/server/app-layer/automations/delivery/sendWebhook";
import { postSlackChatMessage } from "~/server/app-layer/automations/delivery/slackWebApi";
import {
  consumeEmailCapSlot,
  consumeTenantEmailCapSlot,
} from "~/server/app-layer/automations/dispatch/emailCaps";
import {
  dispatchGraphAlertAction,
  type GraphAlertDispatchDeps,
} from "~/server/app-layer/automations/dispatch/graphAlertActionDispatch";
import type { EmailSuppressionService } from "~/server/app-layer/automations/emailSuppression.service";
import {
  evaluateGraphTrigger,
  type GraphTriggerEvaluationDeps,
  type GraphTriggerEvaluationReason,
} from "~/server/app-layer/automations/graph-trigger-evaluation.service";
import {
  decideGraphTriggerHeartbeat,
  type GraphTriggerHeartbeatDeps,
  type GraphTriggerSweepCandidate,
  type HeartbeatCandidateSources,
} from "~/server/app-layer/automations/graph-trigger-heartbeat";
import type { GraphTriggerSentRepository } from "~/server/app-layer/automations/repositories/trigger.repository";
import type { TriggerService } from "~/server/app-layer/automations/trigger.service";
import type { WebhookDeliveryService } from "~/server/app-layer/automations/webhook-delivery.service";
import type { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import type { SystemTraceReadService } from "~/server/app-layer/traces/system-trace-read.service";
import type { TraceReadDerivationService } from "~/server/app-layer/traces/trace-read-derivation.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { DatasetService } from "~/server/datasets/dataset.service";
import type { FoldProjectionStore } from "~/server/event-sourcing.old/projections/foldProjection.types";
import { sendRenderedTriggerEmail } from "~/server/mailer/triggerEmail";

import type { TriggerSettlementDispatchDeps } from "./process-manager/triggerSettlementIntentHandlers";

/**
 * ADR-102. Every line below is `port: (args) => collaborator.method(args)`
 * — nothing here constructs a service, decides a config value, or holds state.
 * The collaborators arrive already built from
 * `app-layer/automations/automation-dispatch.composition.ts`; the ports go into
 * `createAutomationsPipeline`'s `Deps`.
 */
export interface AutomationDispatchCollaborators {
  /** Deep-link host for rendered alert templates. Resolved, never read here. */
  baseHost: string;
  /** ADR-031 per-trigger hourly email cap. */
  emailHourlyCap: number;
  /** ADR-031 per-project daily email cap. */
  tenantDailyCap: number;

  triggers: TriggerService;
  projects: ProjectService;
  evaluationRuns: EvaluationRunService;
  /** ADR-099 timeseries reads, for the custom-graph threshold evaluator. */
  analytics: Pick<AnalyticsService, "getTimeseries">;
  emailSuppressions: Pick<EmailSuppressionService, "filterSuppressed">;
  customGraphs: Pick<AutomationCustomGraphService, "getById">;
  webhookDeliveries: Pick<WebhookDeliveryService, "record" | "pruneExpired">;
  traceReadDerivation: Pick<TraceReadDerivationService, "deriveEvents">;
  traceReads: Pick<SystemTraceReadService, "getById">;
  annotations: Pick<AnnotationService, "enqueueTracesForAnnotators">;
  datasets: Pick<DatasetService, "createRecordsForDatasetId">;

  graphTriggerSent: GraphTriggerSentRepository;
  /** The trace fold the settle confirm re-reads — the same store, over the
   *  same cache tier and key prefix, that the trace pipeline writes. */
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  heartbeat: {
    deps: GraphTriggerHeartbeatDeps;
    sources: HeartbeatCandidateSources;
  };
}

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

export function buildAutomationDispatchPorts(
  collaborators: AutomationDispatchCollaborators,
): AutomationDispatchPorts {
  const graphTriggerEvaluation = graphTriggerEvaluationPorts(collaborators);

  return {
    settlementDeps: settlementDispatchPorts(collaborators),
    evaluateGraphTrigger: async ({ triggerId, projectId, reason }) => {
      await evaluateGraphTrigger({
        deps: graphTriggerEvaluation,
        triggerId,
        projectId,
        reason,
      });
    },
    decideSweepCandidates: ({ now }) =>
      decideGraphTriggerHeartbeat({
        deps: collaborators.heartbeat.deps,
        sources: collaborators.heartbeat.sources,
        now,
      }),
    pruneWebhookDeliveries: () =>
      collaborators.webhookDeliveries.pruneExpired(),
  };
}

/**
 * The ADR-031 hourly cap, bound onto the cap consumer.
 *
 * Shared by both dispatch paths on purpose: the settlement digest and the
 * graph-alert notify hop must consume the SAME cap, and two copies of the
 * binding is how that stops being true the first time one side is edited.
 */
function boundEmailCapSlot(cap: number) {
  return (params: {
    projectId: string;
    triggerId: string;
    now: Date;
    dedupKey: string;
  }) => consumeEmailCapSlot({ ...params, cap });
}

/** What the triggerSettlement process manager's intent handlers call out to. */
function settlementDispatchPorts({
  baseHost,
  emailHourlyCap,
  tenantDailyCap,
  triggers,
  projects,
  evaluationRuns,
  emailSuppressions,
  webhookDeliveries,
  traceReadDerivation,
  traceReads,
  annotations,
  datasets,
  traceSummaryStore,
}: AutomationDispatchCollaborators): TriggerSettlementDispatchDeps {
  return {
    triggers,
    projects,
    baseHost,
    traceSummaryStore,
    evaluationRuns,
    emailHourlyCap,
    tenantDailyCap,
    deriveEvents: (params) => traceReadDerivation.deriveEvents(params),
    consumeEmailCapSlot: boundEmailCapSlot(emailHourlyCap),
    consumeTenantEmailCapSlot: (params) => consumeTenantEmailCapSlot(params),
    filterSuppressedEmails: (params) =>
      emailSuppressions.filterSuppressed(params),
    traceById: (projectId, traceId) =>
      traceReads.getById({ projectId, traceId }),
    addToAnnotationQueue: (params) =>
      annotations.enqueueTracesForAnnotators(params),
    addToDataset: (params) => datasets.createRecordsForDatasetId(params),
    recordWebhookDelivery: (input) => webhookDeliveries.record(input),
  };
}

/** What the ADR-099 custom-graph threshold evaluator calls out to. */
function graphTriggerEvaluationPorts(
  collaborators: AutomationDispatchCollaborators,
): GraphTriggerEvaluationDeps {
  const {
    baseHost,
    triggers,
    projects,
    customGraphs,
    graphTriggerSent,
    analytics,
  } = collaborators;
  const notifierDeps = graphAlertNotifierPorts(collaborators);

  return {
    baseHost,
    triggerSent: graphTriggerSent,
    loadTrigger: (params) => triggers.getById(params),
    loadCustomGraph: (params) => customGraphs.getById(params),
    loadProject: (projectId) => projects.getById(projectId),
    getTimeseries: (input) => analytics.getTimeseries(input),
    updateLastRunAt: ({ triggerId, projectId }) =>
      triggers.updateLastRunAt(triggerId, projectId),
    notifier: {
      dispatch: (input) =>
        dispatchGraphAlertAction({ deps: notifierDeps, input }),
    },
    now: () => new Date(),
  };
}

/**
 * What the graph-alert notify hop calls out to. Deliberately the same senders,
 * suppression list, caps and `TriggerSent` claim store the settlement digest
 * threads in (ADR-031) — a recipient who unsubscribed must not keep receiving
 * alerts through the other path.
 */
function graphAlertNotifierPorts({
  emailHourlyCap,
  tenantDailyCap,
  triggers,
  emailSuppressions,
  webhookDeliveries,
}: AutomationDispatchCollaborators): GraphAlertDispatchDeps {
  return {
    sendEmail: sendRenderedTriggerEmail,
    sendSlack: sendRenderedSlackMessage,
    sendSlackBot: postSlackChatMessage,
    sendWebhook,
    emailHourlyCap,
    tenantDailyCap,
    recordWebhookDelivery: (input) => webhookDeliveries.record(input),
    filterSuppressedRecipients: (params) =>
      emailSuppressions.filterSuppressed(params),
    consumeEmailCapSlot: boundEmailCapSlot(emailHourlyCap),
    consumeTenantEmailCapSlot: (params) => consumeTenantEmailCapSlot(params),
    isRecipientSent: (params) => triggers.isSendClaimed(params),
    recordRecipientSent: async (params) => {
      await triggers.claimSend(params);
    },
  };
}
