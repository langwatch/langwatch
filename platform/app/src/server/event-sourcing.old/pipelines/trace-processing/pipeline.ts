import type { BroadcastService } from "~/server/app-layer/broadcast/broadcast.service";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { createGraphTriggerActivitySubscriber } from "~/server/event-sourcing.old/pipelines/automations/subscribers/graphTriggerActivity.subscriber";
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
import { ContributeSpanFactsCommand } from "../coding-agent-processing/commands/contributeSpanFactsCommand";
import { createCodingAgentSpanFactsDispatchSubscriber } from "../coding-agent-processing/subscribers/codingAgentSpanFactsDispatch.subscriber";
import {
  AddAnnotationCommand,
  BulkSyncAnnotationsCommand,
  RemoveAnnotationCommand,
} from "./commands/annotationCommands";
import { AssignTopicCommand } from "./commands/assignTopicCommand";
import { ChangeTraceNameCommand } from "./commands/changeTraceNameCommand";
import { RecordLogContributionCommand } from "./commands/recordLogContributionCommand";
import { RecordMetricCorrelationCommand } from "./commands/recordMetricCorrelationCommand";
import { RecordSpanCommand } from "./commands/recordSpanCommand";
import { recordSpanOptions } from "./commands/recordSpanOptions";
import { ResolveOriginCommand } from "./commands/resolveOriginCommand";
import { customEvaluationSyncPM } from "./process-manager/customEvaluationSync.process";
import type { CustomEvaluationSyncDispatchDeps } from "./process-manager/customEvaluationSyncIntentHandlers";
import { CUSTOM_EVALUATION_SYNC_PROCESS_NAME } from "./process-manager/customEvaluationSyncProcess.types";
import { evaluationTriggerPM } from "./process-manager/evaluationTrigger.process";
import type { EvaluationTriggerDispatchDeps } from "./process-manager/evaluationTriggerIntentHandlers";
import { EVALUATION_TRIGGER_PROCESS_NAME } from "./process-manager/evaluationTriggerProcess.types";
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

/**
 * ADR-102, with one acknowledged exception — the enterprise block.
 *
 * Every OSS mount below is constructed here from an imported factory: the six
 * subscribers, the three process managers, the four projections and the nine
 * commands. So for the OSS half this file states the whole topology — what the
 * pipeline folds, what it maps, what it dispatches and what it defers.
 *
 * The exception is the five `@ee`-owned members — `automations.triggerMatchSubscriber`,
 * `gatewayBudgetDebitsProjection`, `virtualKeyLastUsedSubscriber`,
 * `governanceKpisProjection` and `governanceOcsfEventsProjection`. Each IS a
 * value the builder registers, which ADR-102 forbids, and each stays that way
 * deliberately: ADR-102's "What does not move" holds that `ee/` cannot be
 * imported unconditionally from an OSS pipeline file, so an enterprise
 * definition crosses this boundary whole or the OSS build does not compile.
 * They are work ADR-102 leaves open, and closing them needs an
 * enterprise composition seam rather than a move.
 */
export interface TraceProcessingPipelineDeps {
  spanAppendStore: AppendStore<NormalizedSpan>;
  /** ADR-099 Phase 1: per-span rollup writer (app-side, replaces the MV). */
  traceAnalyticsRollupAppendStore: AppendStore<TraceAnalyticsRollupRow>;
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  /** ADR-099 Phase 2: slim per-trace fold writer (silent dual-tap, no read path). */
  traceAnalyticsStore: FoldProjectionStore<TraceAnalyticsData>;
  /**
   * ADR-102 — identity-keyed command dispatch. Used here for a *self*
   * reference: the `originGate` process dispatches `resolveOrigin`, which this
   * same pipeline registers; for the billing poke's cross-pipeline hop into
   * billing-reporting; and for the coding-agent span-facts hop (ADR-105).
   * Binding is eager, resolution is not.
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
  /** ADR-098: (re-)arms this project's daily topic-clustering wake. */
  bootstrapTopicClustering: (projectId: string) => Promise<void>;
  /**
   * ADR-098's claim-check for the coding-agent span-facts dispatch: the staged
   * job carries the span's identity and the handler reads the canonical row
   * back out of the span store.
   */
  getNormalizedSpanById: (params: {
    tenantId: string;
    traceId: string;
    spanId: string;
    occurredAtMs: number;
  }) => Promise<NormalizedSpan | null>;
  /** Monitor lookup, trace read-back and evaluation dispatch — a process manager (ADR-098). */
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
   * ADR-098: gateway spend is derived state, so it is a projection and
   * a replay rebuilds it. Absent when ClickHouse is disabled. EE-owned, so the
   * definition crosses whole (see the interface docblock).
   */
  gatewayBudgetDebitsProjection?: MapProjectionDefinition<
    unknown,
    TraceProcessingEvent
  >;
  /** The best-effort `VirtualKey.lastUsedAt` touch the debit write split from. */
  virtualKeyLastUsedSubscriber?: EventSubscriberDefinition<TraceProcessingEvent>;
  /**
   * ADR-099: BlobStore injected so RecordSpanCommand can reconstitute oversized
   * commands (fetch from S3 spool) and best-effort delete the spool after
   * event_log INSERT succeeds. Optional — without it, the spool path is disabled.
   */
  blobStore?: BlobStore;
  /**
   * Number of GroupQueue shards for `recordSpan` commands. `1` (default) keeps
   * the historic per-trace group key; `> 1` spreads a trace's spans across
   * `traceId:<shard>` groups so a hot trace drains in parallel. The trace-summary
   * fold is unaffected — it runs on its own aggregate-keyed queue. See
   * recordSpanOptions.ts and spanCommandGroupKey.ts.
   */
  spanCommandShardCount?: number;
  /** EE-owned governance KPI stream; the definition crosses whole. */
  governanceKpisProjection?: MapProjectionDefinition<
    unknown,
    TraceProcessingEvent
  >;
  /** EE-owned OCSF audit stream; the definition crosses whole. */
  governanceOcsfEventsProjection?: MapProjectionDefinition<
    unknown,
    TraceProcessingEvent
  >;
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
    // ADR-098: perpetual liveness re-assertion, split out of `projectMetadata`
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
    // Cross-pipeline dispatch (ADR-105): coding-agent span facts. The port
    // binds now and resolves on first dispatch, so coding-agent registration
    // order relative to this pipeline carries no meaning.
    .withEventSubscriber(
      "codingAgentSpanFactsDispatch",
      createCodingAgentSpanFactsDispatchSubscriber({
        contributeSpanFacts: deps.commands.port(ContributeSpanFactsCommand),
        getNormalizedSpanById: deps.getNormalizedSpanById,
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
    )
    // A trace that never said where it came from gets an `application` origin
    // once its grace period elapses. The wait is a durable deadline on the
    // process instance, not a delayed job (ADR-103).
    .withProcessManager(
      ORIGIN_GATE_PROCESS_NAME,
      originGatePM({
        resolveOrigin: deps.commands.port(ResolveOriginCommand),
      }),
    )
    .withProcessManager(
      EVALUATION_TRIGGER_PROCESS_NAME,
      evaluationTriggerPM(deps.evaluationTriggerDispatch),
    )
    .withProcessManager(
      CUSTOM_EVALUATION_SYNC_PROCESS_NAME,
      customEvaluationSyncPM(deps.customEvaluationSyncDispatch),
    );

  // The enterprise block. Each of these IS a value the builder registers, which
  // ADR-102 forbids everywhere else in this file — see the `Deps`
  // docblock for why the OSS/EE boundary keeps them injected, and the `if`
  // guard for how an OSS build stays free of them.
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

  // ADR-099: When blobStore is provided, inject it into a pre-constructed
  // RecordSpanCommand instance so the worker can reconstitute oversized commands
  // (S3 spool fetch + best-effort delete). Falls back to zero-arg construction
  // (no spool support) when blobStore is absent — which is not the same call, so
  // this stays a branch rather than becoming an argument.
  const options = recordSpanOptions({
    spanCommandShardCount: deps.spanCommandShardCount,
  });
  const recordSpanBuilder = deps.blobStore
    ? builder.withCommandInstance(
        "recordSpan",
        RecordSpanCommand,
        new RecordSpanCommand({ blobStore: deps.blobStore }),
        options,
      )
    : builder.withCommand("recordSpan", RecordSpanCommand, options);

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
