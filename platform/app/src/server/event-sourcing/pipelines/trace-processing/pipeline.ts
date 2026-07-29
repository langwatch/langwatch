import type { BroadcastService } from "~/server/app-layer/broadcast/broadcast.service";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { createGraphTriggerActivitySubscriber } from "~/server/event-sourcing/pipelines/automations/subscribers/graphTriggerActivity.subscriber";
import { definePipeline } from "../../";
import type { CommandBus } from "../../commands/commandBus";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type {
  AppendStore,
  MapProjectionDefinition,
} from "../../projections/mapProjection.types";
import type { EventSubscriberDefinition } from "../../subscribers/eventSubscriber.types";
import { ReportUsageForMonthCommand } from "../billing-reporting/commands/reportUsageForMonth.command";
import { createBillingMeterPokeSubscriber } from "../billing-reporting/subscribers/billingMeterPoke.subscriber";
import {
  AddAnnotationCommand,
  BulkSyncAnnotationsCommand,
  RemoveAnnotationCommand,
} from "./commands/annotationCommands";
import { AssignTopicCommand } from "./commands/assignTopicCommand";
import { ChangeTraceNameCommand } from "./commands/changeTraceNameCommand";
import { RecordLogContributionCommand } from "./commands/recordLogContributionCommand";
import { RecordMetricCorrelationCommand } from "./commands/recordMetricCorrelationCommand";
import {
  RECORD_SPAN_DEDUPLICATION,
  RecordSpanCommand,
} from "./commands/recordSpanCommand";
import { ResolveOriginCommand } from "./commands/resolveOriginCommand";
import {
  clampSpanShardCount,
  spanCommandGroupKey,
} from "./commands/spanCommandGroupKey";
import {
  buildProcessEventView as buildCustomEvaluationSyncEventView,
  CUSTOM_EVALUATION_SYNC_ENQUEUE,
  handleSpanReceived as handleCustomEvaluationSpanReceived,
} from "./process-manager/customEvaluationSync.process";
import {
  type CustomEvaluationSyncDispatchDeps,
  createCustomEvaluationReportHandler,
} from "./process-manager/customEvaluationSyncIntentHandlers";
import {
  CUSTOM_EVALUATION_SYNC_INTENT_TYPES,
  CUSTOM_EVALUATION_SYNC_LEASE_DURATION_MS,
  CUSTOM_EVALUATION_SYNC_MAX_ATTEMPTS,
  CUSTOM_EVALUATION_SYNC_PROCESS_NAME,
  customEvaluationReportIntentSchema,
  customEvaluationSyncRetryDelayMs,
  INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
} from "./process-manager/customEvaluationSyncProcess.types";
import {
  buildProcessEventView as buildEvaluationTriggerEventView,
  EVALUATION_TRIGGER_ENQUEUE,
  evaluationTriggerWake,
  handleTraceActivity as handleEvaluationTriggerActivity,
} from "./process-manager/evaluationTrigger.process";
import {
  createEvaluationTriggerRequestHandler,
  type EvaluationTriggerDispatchDeps,
} from "./process-manager/evaluationTriggerIntentHandlers";
import {
  EVALUATION_TRIGGER_INTENT_TYPES,
  EVALUATION_TRIGGER_LEASE_DURATION_MS,
  EVALUATION_TRIGGER_MAX_ATTEMPTS,
  EVALUATION_TRIGGER_PROCESS_NAME,
  evaluationTriggerRequestIntentSchema,
  INITIAL_EVALUATION_TRIGGER_STATE,
} from "./process-manager/evaluationTriggerProcess.types";
import { originGatePM } from "./process-manager/originGate.process";
import { ORIGIN_GATE_PROCESS_NAME } from "./process-manager/originGateProcess.types";
import { SpanStorageMapProjection } from "./projections/spanStorage.mapProjection";
import {
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
} from "./projections/traceAnalytics.foldProjection";
import {
  TraceAnalyticsRollupMapProjection,
  type TraceAnalyticsRollupRow,
} from "./projections/traceAnalyticsRollup.mapProjection";
import { TraceSummaryFoldProjection } from "./projections/traceSummary.foldProjection";
import type { RecordSpanCommandData } from "./schemas/commands";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "./schemas/constants";
import type { TraceProcessingEvent } from "./schemas/events";
import type { NormalizedSpan } from "./schemas/spans";
import { createProjectMetadataSubscriber } from "./subscribers/projectMetadata.subscriber";
import { createSpanStorageBroadcastSubscriber } from "./subscribers/spanStorageBroadcast.subscriber";
import { createTopicClusteringBootstrapSubscriber } from "./subscribers/topicClusteringBootstrap.subscriber";
import { createTraceUpdateBroadcastSubscriber } from "./subscribers/traceUpdateBroadcast.subscriber";
import { TraceRequestUtils } from "./utils/traceRequest.utils";

/**
 * ADR-082 Rule 1 — nothing crossing this boundary is a value the builder
 * registers. The four subscribers, the three process managers and the billing
 * poke are all constructed here from imported factories, so this file states
 * the whole topology: what the pipeline folds, what it maps, what it dispatches
 * and what it defers.
 */
export interface TraceProcessingPipelineDeps {
  spanAppendStore: AppendStore<NormalizedSpan>;
  /** ADR-034 Phase 1: per-span rollup writer (app-side, replaces the MV). */
  traceAnalyticsRollupAppendStore: AppendStore<TraceAnalyticsRollupRow>;
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  /** ADR-034 Phase 2: slim per-trace fold writer (silent dual-tap, no read path). */
  traceAnalyticsStore: FoldProjectionStore<TraceAnalyticsData>;
  /**
   * ADR-082 §5 — identity-keyed command dispatch. Used here for a *self*
   * reference: the `originGate` process dispatches `resolveOrigin`, which this
   * same pipeline registers, and for the billing poke's cross-pipeline hop into
   * billing-reporting. Binding is eager, resolution is not.
   */
  commands: CommandBus;
  /** SSE fan-out for the trace drawer and the span tree. */
  broadcast: BroadcastService;
  /**
   * Without Redis the worker-to-web pub/sub bridge does not exist, so the two
   * broadcast subscribers are disabled rather than pushing into nothing.
   */
  hasRedis: boolean;
  /** Read by the onboarding latch and by the clustering liveness check. */
  projects: ProjectService;
  /** ADR-051: (re-)arms this project's daily topic-clustering wake. */
  bootstrapTopicClustering: (projectId: string) => Promise<void>;
  /** Monitor lookup, trace read-back and evaluation dispatch (ADR-075 Class D). */
  evaluationTriggerDispatch: EvaluationTriggerDispatchDeps;
  /** Span read-back and evaluation reporting for SDK-run evaluations. */
  customEvaluationSyncDispatch: CustomEvaluationSyncDispatchDeps;
  /** Usage reporting exists only in the SaaS build; the poke is off elsewhere. */
  isSaas: boolean;
  automations: {
    /**
     * Matches a trace against the project's automations. An EE-owned
     * subscriber definition rather than a handler: the OSS pipeline may not
     * import enterprise code, so the whole definition crosses the boundary.
     */
    triggerMatchSubscriber: EventSubscriberDefinition<TraceProcessingEvent>;
    graphActivityHandler: (
      event: TraceProcessingEvent,
      context: { tenantId: string },
    ) => Promise<void>;
  };
  /**
   * ADR-075 Class C: gateway spend is derived state, so it is a projection and
   * a replay rebuilds it. Absent when ClickHouse is disabled.
   */
  gatewayBudgetDebitsProjection?: MapProjectionDefinition<
    unknown,
    TraceProcessingEvent
  >;
  /** The best-effort `VirtualKey.lastUsedAt` touch the debit write split from. */
  virtualKeyLastUsedSubscriber?: EventSubscriberDefinition<TraceProcessingEvent>;
  /**
   * ADR-022: BlobStore injected so RecordSpanCommand can reconstitute oversized
   * commands (fetch from S3 spool) and best-effort delete the spool after
   * event_log INSERT succeeds. Optional — without it, the spool path is disabled.
   */
  blobStore?: BlobStore;
  /**
   * Number of GroupQueue shards for `recordSpan` commands. `1` (default) keeps
   * the historic per-trace group key; `> 1` spreads a trace's spans across
   * `traceId:<shard>` groups so a hot trace drains in parallel. The trace-summary
   * fold is unaffected — it runs on its own aggregate-keyed queue. See
   * spanCommandGroupKey.ts.
   */
  spanCommandShardCount?: number;
  governanceKpisProjection?: MapProjectionDefinition<
    unknown,
    TraceProcessingEvent
  >;
  governanceOcsfEventsProjection?: MapProjectionDefinition<
    unknown,
    TraceProcessingEvent
  >;
  /** Cross-pipeline dispatchers (e.g. coding-agent span-facts, ADR-056). */
  subscribers?: EventSubscriberDefinition<TraceProcessingEvent>[];
}

/**
 * Creates the trace processing pipeline definition.
 *
 * This pipeline uses trace-level aggregates (aggregateId = traceId).
 * It aggregates span events into trace summary metrics (fold projection) and writes
 * individual spans to the stored_spans table (map projection).
 */
export function createTraceProcessingPipeline(
  deps: TraceProcessingPipelineDeps,
) {
  let builder = definePipeline<TraceProcessingEvent>()
    .withName("trace_processing")
    .withAggregateType("trace")
    .withFoldProjection(
      "traceSummary",
      new TraceSummaryFoldProjection({
        store: deps.traceSummaryStore,
      }),
    )
    .withFoldProjection(
      "traceAnalytics",
      new TraceAnalyticsFoldProjection({
        store: deps.traceAnalyticsStore,
      }),
    )
    .withMapProjection(
      "spanStorage",
      new SpanStorageMapProjection({
        store: deps.spanAppendStore,
      }),
    )
    .withMapProjection(
      "traceAnalyticsRollup",
      new TraceAnalyticsRollupMapProjection({
        store: deps.traceAnalyticsRollupAppendStore,
      }),
    )
    // A trace that never said where it came from gets an `application` origin
    // once its grace period elapses. The wait is a durable deadline on the
    // process instance, not a delayed job (ADR-073).
    .withProcessManager(
      ORIGIN_GATE_PROCESS_NAME,
      originGatePM({
        resolveOrigin: deps.commands.port(ResolveOriginCommand),
      }),
    )
    // The project's on-message monitors run once the trace has gone quiet for a
    // full period. The quiet period is re-armed by every message, so a
    // conversation that resumes pushes its own evaluation out; every fallible
    // guard lives in the intent handler, where a failure retries the ask
    // instead of dropping it (ADR-075 Class D).
    .withProcessManager(EVALUATION_TRIGGER_PROCESS_NAME, (pm) =>
      pm
        .state(INITIAL_EVALUATION_TRIGGER_STATE)
        .intent(
          EVALUATION_TRIGGER_INTENT_TYPES.REQUEST_EVALUATIONS,
          evaluationTriggerRequestIntentSchema,
          createEvaluationTriggerRequestHandler(deps.evaluationTriggerDispatch),
        )
        .on(SPAN_RECEIVED_EVENT_TYPE, handleEvaluationTriggerActivity)
        .on(ORIGIN_RESOLVED_EVENT_TYPE, handleEvaluationTriggerActivity)
        .onWake(evaluationTriggerWake)
        .toPayload(buildEvaluationTriggerEventView)
        .enqueue(EVALUATION_TRIGGER_ENQUEUE)
        .outbox({
          maxAttempts: EVALUATION_TRIGGER_MAX_ATTEMPTS,
          leaseDurationMs: EVALUATION_TRIGGER_LEASE_DURATION_MS,
        }),
    )
    // Evaluations an SDK ran itself arrive stapled to a span. The intent
    // carries the span's identity alone and reads the verdicts back out of the
    // span store (ADR-069's claim-check), so the retries are sized for losing
    // the race against the sibling span write rather than for a failing
    // command.
    .withProcessManager(CUSTOM_EVALUATION_SYNC_PROCESS_NAME, (pm) =>
      pm
        .state(INITIAL_CUSTOM_EVALUATION_SYNC_STATE)
        .intent(
          CUSTOM_EVALUATION_SYNC_INTENT_TYPES.REPORT_EVALUATIONS,
          customEvaluationReportIntentSchema,
          createCustomEvaluationReportHandler(
            deps.customEvaluationSyncDispatch,
          ),
        )
        .on(SPAN_RECEIVED_EVENT_TYPE, handleCustomEvaluationSpanReceived)
        .toPayload(buildCustomEvaluationSyncEventView)
        .enqueue(CUSTOM_EVALUATION_SYNC_ENQUEUE)
        .outbox({
          maxAttempts: CUSTOM_EVALUATION_SYNC_MAX_ATTEMPTS,
          leaseDurationMs: CUSTOM_EVALUATION_SYNC_LEASE_DURATION_MS,
          retryDelayMs: customEvaluationSyncRetryDelayMs,
        }),
    )
    .withEventSubscriber(
      "traceUpdateBroadcast",
      createTraceUpdateBroadcastSubscriber({
        broadcast: deps.broadcast,
        hasRedis: deps.hasRedis,
      }),
    )
    .withEventSubscriber(
      "spanStorageBroadcast",
      createSpanStorageBroadcastSubscriber({
        broadcast: deps.broadcast,
        hasRedis: deps.hasRedis,
      }),
    )
    .withEventSubscriber(
      "projectMetadata",
      createProjectMetadataSubscriber({ projects: deps.projects }),
    )
    // ADR-051: perpetual liveness re-assertion, split out of `projectMetadata`
    // so a Prisma blip on the onboarding latch can no longer skip it.
    .withEventSubscriber(
      "topicClusteringBootstrap",
      createTopicClusteringBootstrapSubscriber({
        projects: deps.projects,
        bootstrapTopicClustering: deps.bootstrapTopicClustering,
      }),
    )
    // Span events are the busiest billable stream in the product; the poke's
    // per-project dedup window is what makes a subscriber affordable here.
    .withEventSubscriber(
      "billingMeterPoke",
      createBillingMeterPokeSubscriber<TraceProcessingEvent>({
        eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
        reportUsageForMonth: deps.commands.port(ReportUsageForMonthCommand),
        isSaas: deps.isSaas,
      }),
    )
    .withEventSubscriber(
      "triggerMatch",
      deps.automations.triggerMatchSubscriber,
    )
    .withEventSubscriber(
      "graphTriggerActivity",
      createGraphTriggerActivitySubscriber<TraceProcessingEvent>({
        eventTypes: [SPAN_RECEIVED_EVENT_TYPE, ORIGIN_RESOLVED_EVENT_TYPE],
        handler: deps.automations.graphActivityHandler,
      }),
    );

  if (deps.gatewayBudgetDebitsProjection) {
    builder = builder.withMapProjection(
      "gatewayBudgetDebits",
      deps.gatewayBudgetDebitsProjection,
    );
  }

  if (deps.virtualKeyLastUsedSubscriber) {
    builder = builder.withEventSubscriber(
      "virtualKeyLastUsed",
      deps.virtualKeyLastUsedSubscriber,
    );
  }

  if (deps.governanceKpisProjection) {
    builder = builder.withMapProjection(
      "governanceKpis",
      deps.governanceKpisProjection,
    );
  }

  if (deps.governanceOcsfEventsProjection) {
    builder = builder.withMapProjection(
      "governanceOcsfEvents",
      deps.governanceOcsfEventsProjection,
    );
  }

  for (const subscriber of deps.subscribers ?? []) {
    builder = builder.withEventSubscriber(subscriber.name, subscriber);
  }

  // Span-command sharding: when the shard count is > 1, install a getGroupKey
  // that spreads a trace's recordSpan commands across `traceId:<shard>`
  // GroupQueue groups so a hot trace drains in parallel instead of one span at a
  // time. When disabled (the default), install NO getGroupKey — the command
  // falls back to getAggregateId, byte-identical to the historic per-trace key
  // and with zero extra work on the span-ingest hot path. The count is clamped
  // defensively so a caller constructing the pipeline directly (bypassing
  // PipelineRegistry's env resolver) can't explode the number of groups. The
  // command handler reads no trace state and the emitted span_received event
  // still carries aggregateId = traceId, so the trace-summary fold (its own
  // aggregate-keyed queue) is unaffected and the summary stays exact. See
  // spanCommandGroupKey.ts and specs/event-sourcing/span-command-sharding.feature.
  const spanCommandShardCount = clampSpanShardCount(
    deps.spanCommandShardCount ?? 1,
  );
  const recordSpanOptions: {
    deduplication: typeof RECORD_SPAN_DEDUPLICATION;
    getGroupKey?: (payload: RecordSpanCommandData) => string;
  } = { deduplication: RECORD_SPAN_DEDUPLICATION };
  if (spanCommandShardCount > 1) {
    recordSpanOptions.getGroupKey = (payload) => {
      const { traceId, spanId } = TraceRequestUtils.normalizeOtlpSpanIds(
        payload.span,
      );
      return spanCommandGroupKey({
        traceId,
        spanId,
        shardCount: spanCommandShardCount,
      });
    };
  }

  // ADR-022: When blobStore is provided, inject it into a pre-constructed
  // RecordSpanCommand instance so the worker can reconstitute oversized commands
  // (S3 spool fetch + best-effort delete). Falls back to zero-arg construction
  // (no spool support) when blobStore is absent. Either way the recordSpan
  // command carries the dedup config and span-command sharding from main.
  const recordSpanBuilder = deps.blobStore
    ? builder.withCommandInstance(
        "recordSpan",
        RecordSpanCommand,
        new RecordSpanCommand({ blobStore: deps.blobStore }),
        recordSpanOptions,
      )
    : builder.withCommand("recordSpan", RecordSpanCommand, recordSpanOptions);

  return recordSpanBuilder
    .withCommand("assignTopic", AssignTopicCommand)
    .withCommand("recordLogContribution", RecordLogContributionCommand)
    .withCommand("recordMetricCorrelation", RecordMetricCorrelationCommand)
    .withCommand("resolveOrigin", ResolveOriginCommand)
    .withCommand("addAnnotation", AddAnnotationCommand)
    .withCommand("removeAnnotation", RemoveAnnotationCommand)
    .withCommand("bulkSyncAnnotations", BulkSyncAnnotationsCommand)
    .withCommand("changeTraceName", ChangeTraceNameCommand)
    .build();
}
