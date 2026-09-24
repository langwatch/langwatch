import {
  defineEventingModule,
  throttledWindow,
  type EventingSetup,
  type TriggerContext,
} from "@langwatch/eventing";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
  type TraceProcessingEvent,
  type TraceSummaryData,
} from "@langwatch/trace-contract";

import type { TraceApp } from "../app/trace.app.ts";
import type { TraceProcessingPipelineDefinition } from "../app/trace.members.ts";
import type { EventingTracePipelineAdapter } from "../services/eventing.trace-pipeline.service.ts";
import {
  CUSTOM_EVAL_SYNC_DEDUP_TTL_MS,
  CUSTOM_EVAL_SYNC_DELAY_MS,
  CustomEvaluationSync,
} from "./custom-evaluation-sync.subscriber.ts";
import {
  DEFERRED_ORIGIN_INITIAL_STATE,
  DEFERRED_ORIGIN_PROCESS_NAME,
  type DeferredOriginState,
  deferredOriginWake,
  onOriginResolvedDisarm,
  onSpanReceivedArmOrigin,
  resolveDeferredOriginIntentSchema,
} from "./deferred-origin.process.ts";
import {
  EXPERIMENT_METRICS_SYNC_DEDUP_TTL_MS,
  EXPERIMENT_METRICS_SYNC_DELAY_MS,
  hasExperimentCostMetrics,
} from "./experiment-metrics-sync.subscriber.ts";
import type { TraceSummarySubscriber } from "./origin-guarded.subscriber.ts";
import { PROJECT_METADATA_WINDOW_MS, ProjectMetadataSync } from "./project-metadata.subscriber.ts";
import {
  SIMULATION_METRICS_SYNC_DEDUP_TTL_MS,
  SIMULATION_METRICS_SYNC_DELAY_MS,
  hasSimulationMetrics,
} from "./simulation-metrics-sync.subscriber.ts";
import { SPAN_STORAGE_BROADCAST_DEDUP_TTL_MS } from "./span-storage-broadcast.subscriber.ts";
import { TRACE_UPDATE_BROADCAST_WINDOW_MS } from "./trace-update-broadcast.subscriber.ts";
import {
  TRACKED_EVENT_SYNC_DEDUP_TTL_MS,
  TRACKED_EVENT_SYNC_DELAY_MS,
  TrackedEventSync,
} from "./tracked-event-sync.subscriber.ts";

/** Automation's graph-alert debounce, restated as evaluation-processing.service.ts:37 does. */
const GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS = 5_000;

function graphTriggerActivityGroupKey(event: { tenantId: string }): string {
  return `graph-trigger-activity:${event.tenantId}`;
}

type SummaryHandler = (
  event: TraceProcessingEvent,
  context: TriggerContext<TraceSummaryData>,
) => Promise<void>;

/** Every reaction main's worker hung on trace_processing, keyed by its queued name. */
export interface TraceProcessingReactions {
  resolveDeferredOrigin: (payload: { tenantId: string; traceId: string }) => Promise<void>;
  evaluationTrigger: TraceSummarySubscriber;
  customEvaluationSync: SummaryHandler;
  trackedEventSync: SummaryHandler;
  traceUpdateBroadcast: SummaryHandler;
  projectMetadata: SummaryHandler;
  simulationMetricsSync: SummaryHandler;
  experimentMetricsSync: SummaryHandler;
  triggerMatch: SummaryHandler;
  graphTriggerActivity: (
    event: TraceProcessingEvent,
    context: { tenantId: string },
  ) => Promise<void>;
  spanStorageBroadcast: (
    event: TraceProcessingEvent,
    context: TriggerContext<unknown>,
  ) => Promise<void>;
  broadcastDisabled: boolean;
}

/** The consuming definition: projections, main's subscribers and the deferred-origin manager. */
export function buildTraceProcessingConsumer(
  projections: ReturnType<EventingTracePipelineAdapter["build"]>,
  reactions: TraceProcessingReactions,
): TraceProcessingPipelineDefinition {
  return projections
    .withProcessManager(DEFERRED_ORIGIN_PROCESS_NAME, (pm) =>
      pm
        .state<DeferredOriginState>(DEFERRED_ORIGIN_INITIAL_STATE)
        .intent("resolveDeferredOrigin", resolveDeferredOriginIntentSchema, (payload) =>
          reactions.resolveDeferredOrigin(payload),
        )
        .on(SPAN_RECEIVED_EVENT_TYPE, onSpanReceivedArmOrigin)
        .on(ORIGIN_RESOLVED_EVENT_TYPE, onOriginResolvedDisarm)
        .onWake(deferredOriginWake),
    )
    .withProjectionSubscriber(reactions.evaluationTrigger.name, reactions.evaluationTrigger.spec)
    .withProjectionSubscriber("customEvaluationSync", {
      fold: "traceSummary",
      events: [SPAN_RECEIVED_EVENT_TYPE],
      when: (event) => CustomEvaluationSync.hasSyncableEvaluations(event),
      delay: CUSTOM_EVAL_SYNC_DELAY_MS,
      ttl: CUSTOM_EVAL_SYNC_DEDUP_TTL_MS,
      dedupId: (event) => CustomEvaluationSync.customEvaluationSyncDedupId(event),
      handler: (event, context) => reactions.customEvaluationSync(event, context),
    })
    .withProjectionSubscriber("trackedEventSync", {
      fold: "traceSummary",
      events: [SPAN_RECEIVED_EVENT_TYPE],
      when: (event) => TrackedEventSync.hasSyncableFeedback(event),
      delay: TRACKED_EVENT_SYNC_DELAY_MS,
      ttl: TRACKED_EVENT_SYNC_DEDUP_TTL_MS,
      dedupId: (event) => TrackedEventSync.trackedEventSyncDedupId(event),
      handler: (event, context) => reactions.trackedEventSync(event, context),
    })
    .withProjectionSubscriber("traceUpdateBroadcast", {
      fold: "traceSummary",
      runIn: ["worker"],
      disabled: reactions.broadcastDisabled,
      ...throttledWindow<TraceProcessingEvent>({
        makeId: (event) => `${event.tenantId}:${event.aggregateId}`,
        windowMs: TRACE_UPDATE_BROADCAST_WINDOW_MS,
      }),
      handler: (event, context) => reactions.traceUpdateBroadcast(event, context),
    })
    .withProjectionSubscriber("projectMetadata", {
      fold: "traceSummary",
      runIn: ["worker"],
      when: (_event, context) => ProjectMetadataSync.isRealFirstIngest(context.state),
      groupKeyFn: (event) => ProjectMetadataSync.projectMetadataGroupKey(event),
      ...throttledWindow<TraceProcessingEvent>({
        makeId: (event) => event.tenantId,
        windowMs: PROJECT_METADATA_WINDOW_MS,
      }),
      handler: (event, context) => reactions.projectMetadata(event, context),
    })
    .withProjectionSubscriber("simulationMetricsSync", {
      fold: "traceSummary",
      when: (_event, context) => hasSimulationMetrics(context.state),
      delay: SIMULATION_METRICS_SYNC_DELAY_MS,
      ttl: SIMULATION_METRICS_SYNC_DEDUP_TTL_MS,
      handler: (event, context) => reactions.simulationMetricsSync(event, context),
    })
    .withProjectionSubscriber("experimentMetricsSync", {
      fold: "traceSummary",
      when: (_event, context) => hasExperimentCostMetrics(context.state),
      delay: EXPERIMENT_METRICS_SYNC_DELAY_MS,
      ttl: EXPERIMENT_METRICS_SYNC_DEDUP_TTL_MS,
      handler: (event, context) => reactions.experimentMetricsSync(event, context),
    })
    .withProjectionSubscriber("triggerMatch", {
      fold: "traceSummary",
      events: [SPAN_RECEIVED_EVENT_TYPE, ORIGIN_RESOLVED_EVENT_TYPE],
      delay: 30_000,
      ttl: 30_000,
      handler: (event, context) => reactions.triggerMatch(event, context),
    })
    .withEventSubscriber("graphTriggerActivity", {
      events: [SPAN_RECEIVED_EVENT_TYPE, ORIGIN_RESOLVED_EVENT_TYPE],
      delay: GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
      dedup: {
        makeId: graphTriggerActivityGroupKey,
        ttlMs: GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
        extend: false,
        replace: false,
      },
      // One lane per tenant, shared with evaluation_processing's registration.
      groupKeyFn: graphTriggerActivityGroupKey,
      handler: (event, context) => reactions.graphTriggerActivity(event, context),
    })
    .withProjectionSubscriber("spanStorageBroadcast", {
      map: "spanStorage",
      runIn: ["worker"],
      disabled: reactions.broadcastDisabled,
      ttl: SPAN_STORAGE_BROADCAST_DEDUP_TTL_MS,
      handler: (event, context) => reactions.spanStorageBroadcast(event, context),
    })
    .build();
}

/** trace_processing, built by the app in both roles; its senders carry every trace write. */
export const traceProcessingEventing = defineEventingModule({
  pipeline: "trace_processing",
  build: ({ app, participation }: EventingSetup<never, TraceApp>) =>
    app.traceProcessingPipeline({ participation }),
  connect: ({ app, commands }) => app.connectTraceProcessingCommands(commands),
});
