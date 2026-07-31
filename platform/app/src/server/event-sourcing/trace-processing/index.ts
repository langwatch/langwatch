import {
  type ClickHouseClient,
  clickhouseAppend,
  clickhouseReplacing,
  type FoldStateCache,
  noFoldStateCache,
} from "@langwatch/clickhouse";
import {
  type AppendStore,
  type BuiltMap,
  type BuiltSubscriber,
  ConfigurationError,
  definePipeline,
  type GroupKey,
  type Metrics,
  type Mount,
  type PipelineChainWithId,
  type ReplaceStore,
  validateMount,
} from "@langwatch/event-sourcing";
import {
  createGraphTriggerActivitySubscriber,
  type GraphTriggerActivityPorts,
} from "../automations/subscribers";
import {
  createSpanFactsBridge,
  type SpanFactsBridgeDeps,
} from "../coding-agent-processing/bridge/dispatch";
import { addAnnotation } from "./addAnnotation.command";
import { assignTopic } from "./assignTopic.command";
import { bulkSyncAnnotations } from "./bulkSyncAnnotations.command";
import { changeTraceName } from "./changeTraceName.command";
import {
  CUSTOM_EVALUATION_SYNC_PROCESS_NAME,
  type CustomEvaluationSyncDispatchDeps,
  customEvaluationSyncOn,
  customEvaluationSyncStateSchema,
  initCustomEvaluationSyncState,
  reportEvaluationsIntents,
} from "./customEvaluationSync.process";
import {
  EVALUATION_TRIGGER_PROCESS_NAME,
  type EvaluationTriggerDispatchDeps,
  evaluationTriggerOn,
  evaluationTriggerOnWake,
  evaluationTriggerStateSchema,
  initEvaluationTriggerState,
  requestEvaluationsIntents,
} from "./evaluationTrigger.process";
import {
  TRACE_PIPELINE_NAME,
  TRACE_PIPELINE_PREFIX,
  traceEvents,
} from "./events";
import {
  initOriginGateState,
  ORIGIN_GATE_PROCESS_NAME,
  type OriginGateDispatchDeps,
  originGateIntents,
  originGateOn,
  originGateOnWake,
  originGateStateSchema,
} from "./originGate.process";
import { recordLogContribution } from "./recordLogContribution.command";
import { recordMetricCorrelation } from "./recordMetricCorrelation.command";
import { recordSpan } from "./recordSpan.command";
import { removeAnnotation } from "./removeAnnotation.command";
import { resolveOrigin } from "./resolveOrigin.command";
import {
  annotationRefSchema,
  annotationsBulkSyncSchema,
  type CanonicalSpan,
  canonicalSpanSchema,
  logContributionSchema,
  metricCorrelationSchema,
  originResolutionSchema,
  topicAssignmentSchema,
  traceNameChangeSchema,
} from "./schema";
import {
  mapSpanReceived,
  type StoredSpanRecord,
  toStoredSpanRow,
} from "./spanStorage.projection";
import {
  storedSpansTable,
  traceAnalyticsTable,
  traceSummariesTable,
} from "./table";
import {
  handleAnnotationAdded as analyticsHandleAnnotationAdded,
  handleAnnotationRemoved as analyticsHandleAnnotationRemoved,
  handleAnnotationsBulkSynced as analyticsHandleAnnotationsBulkSynced,
  handleOriginResolved as analyticsHandleOriginResolved,
  handleSpanReceived as analyticsHandleSpanReceived,
  handleTopicAssigned as analyticsHandleTopicAssigned,
  handleTraceNameChanged as analyticsHandleTraceNameChanged,
  initTraceAnalyticsState,
  TRACE_ANALYTICS_STATE_VERSION,
  type TraceAnalyticsState,
  traceAnalyticsRowMapping,
  traceAnalyticsStateSchema,
} from "./traceAnalytics.projection";
import {
  handleLogContributed,
  handleMetricDataPointCorrelated,
  initTraceSummaryState,
  handleAnnotationAdded as summaryHandleAnnotationAdded,
  handleAnnotationRemoved as summaryHandleAnnotationRemoved,
  handleAnnotationsBulkSynced as summaryHandleAnnotationsBulkSynced,
  handleOriginResolved as summaryHandleOriginResolved,
  handleSpanReceived as summaryHandleSpanReceived,
  handleTopicAssigned as summaryHandleTopicAssigned,
  handleTraceNameChanged as summaryHandleTraceNameChanged,
  TRACE_SUMMARY_STATE_VERSION,
  type TraceSummaryState,
  traceSummaryRowMapping,
  traceSummaryStateSchema,
} from "./traceSummary.projection";

const DEFAULT_RETENTION_DAYS = 308;

/** Both folds read prior state, so each one gets its own per-trace lane (ADR-100). */
export function traceFoldGroupKey(args: {
  readonly tenantId: string;
  readonly projection: "traceSummary" | "traceAnalytics";
  readonly traceId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "fold", name: args.projection },
    scope: {
      kind: "aggregate",
      aggregateType: TRACE_PIPELINE_NAME,
      aggregateId: args.traceId,
    },
  };
}

/** Event-scoped: independent per-span writes that still coalesce into one insert. */
export function spanStorageGroupKey(args: {
  readonly tenantId: string;
  readonly eventId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: "spanStorage" },
    scope: { kind: "event", eventId: args.eventId },
  };
}

export function traceCommandGroupKey(args: {
  readonly tenantId: string;
  readonly command: string;
  readonly traceId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "command", name: args.command },
    scope: {
      kind: "aggregate",
      aggregateType: TRACE_PIPELINE_NAME,
      aggregateId: args.traceId,
    },
  };
}

/**
 * `batch`, not `none`: one delivery may carry several spans for one trace,
 * applied in order as a single unit of work.
 */
export function traceSummaryMount(
  store: ReplaceStore<TraceSummaryState>,
): Mount {
  return {
    projection: "fold",
    store: store.kind,
    scope: "aggregate",
    collapse: "batch",
  };
}

export function traceAnalyticsMount(
  store: ReplaceStore<TraceAnalyticsState>,
): Mount {
  return {
    projection: "fold",
    store: store.kind,
    scope: "aggregate",
    collapse: "batch",
  };
}

/**
 * One lane per span event. `collapse: none` because an event-scoped lane can
 * never gather a batch; many such lanes still coalesce into one insert via
 * the store's own bulk write.
 */
export function spanStorageMount(store: AppendStore<StoredSpanRecord>): Mount {
  return {
    projection: "map",
    store: store.kind,
    scope: "event",
    collapse: "none",
  };
}

/** Refuses an illegal mount at composition, not on the first delivery (ADR-106). */
function assertMountIsLegal(projection: string, mount: Mount): Mount {
  const violations = validateMount(mount);
  if (violations.length > 0) {
    throw new ConfigurationError(
      `trace-processing's ${projection} mount is illegal: ${violations
        .map((v) => `${v.rule} — ${v.message}`)
        .join("; ")}`,
      { pipeline: TRACE_PIPELINE_NAME, projection, violations },
    );
  }
  return mount;
}

/** A project's ingest signals read off one committed event — resource-level
 * facts, identical on every span one exporter emits, so which event of a
 * debounce window answers cannot disagree with the others. */
interface IngestSignals {
  readonly origin: string | null;
  readonly sdkLanguage: string | null;
  readonly sdkFramework: string | null;
  readonly platform: string | null;
}

function ingestSignalsFromSpan(data: CanonicalSpan): IngestSignals {
  const origin =
    data.attributes["langwatch.origin"] ??
    data.resourceAttributes["langwatch.origin"];
  const sdkLanguage = data.resourceAttributes["telemetry.sdk.language"];
  const sdkFramework =
    data.resourceAttributes["langwatch.sdk.framework"] ??
    data.attributes["langwatch.sdk.framework"];
  const platform = data.resourceAttributes["langwatch.platform"];
  return {
    origin: typeof origin === "string" ? origin : null,
    sdkLanguage: typeof sdkLanguage === "string" ? sdkLanguage : null,
    sdkFramework: typeof sdkFramework === "string" ? sdkFramework : null,
    platform: typeof platform === "string" ? platform : null,
  };
}

/** Seeded sample traces (the empty-state "Seed sample traces" path) must
 * never count as a real ingest signal. */
function isSampleIngest(signals: IngestSignals): boolean {
  return signals.origin === "sample";
}

export interface ProjectMetadataPorts {
  getById(
    tenantId: string,
  ): Promise<{ firstMessage: boolean; integrated: boolean } | null>;
  updateMetadata(params: {
    id: string;
    data: { firstMessage: boolean; integrated: boolean; language: string };
  }): Promise<void>;
  /** The PostHog distinct_id the browser identifies the admin with. */
  resolveOrgAdmin(tenantId: string): Promise<{ userId: string | null }>;
  /**
   * Tracks the `first_trace_integrated` product-analytics milestone.
   * The composition root binds this to PostHog; the pipeline stays IO-free.
   */
  trackFirstTraceIntegrated(params: {
    userId: string;
    projectId: string;
    sdkLanguage: string;
    sdkFramework: string;
  }): void;
}

async function applyProjectMetadata(
  ports: ProjectMetadataPorts,
  signals: IngestSignals,
  tenantId: string,
): Promise<void> {
  if (isSampleIngest(signals)) return;
  const project = await ports.getById(tenantId);
  if (!project || (project.firstMessage && project.integrated)) return;

  const isOptimizationStudio = signals.platform === "optimization_studio";
  const language =
    isOptimizationStudio || signals.sdkLanguage === null
      ? "other"
      : signals.sdkLanguage === "python" || signals.sdkLanguage === "typescript"
        ? signals.sdkLanguage
        : "other";

  await ports.updateMetadata({
    id: tenantId,
    data: {
      firstMessage: true,
      integrated: isOptimizationStudio ? project.integrated : true,
      language,
    },
  });

  // Track the milestone only on the firstMessage transition, and only after
  // the write commits. A failed write retries on the project's next trace
  // instead of dropping the event.
  if (project.firstMessage) return;
  const { userId } = await ports.resolveOrgAdmin(tenantId);
  if (!userId) return;
  ports.trackFirstTraceIntegrated({
    userId,
    projectId: tenantId,
    sdkLanguage: signals.sdkLanguage ?? "unknown",
    sdkFramework: signals.sdkFramework ?? "unknown",
  });
}

export interface TraceProcessingBroadcastPorts {
  broadcastToTenant(
    tenantId: string,
    payload: string,
    eventType: string,
  ): Promise<void>;
}

/** The five pre-built enterprise members (ADR-107 decision 17): constructed
 * by the composition root from `ee/`, never imported here. */
export interface TraceProcessingEnterpriseDeps {
  readonly traceAlertTriggerMatch?: BuiltSubscriber;
  readonly virtualKeyLastUsed?: BuiltSubscriber;
  readonly gatewayBudgetDebits?: {
    readonly map: BuiltMap;
    readonly mount: Mount;
  };
  readonly governanceKpis?: { readonly map: BuiltMap; readonly mount: Mount };
  readonly governanceOcsfEvents?: {
    readonly map: BuiltMap;
    readonly mount: Mount;
  };
}

export interface TraceProcessingPipelineDeps {
  readonly client: ClickHouseClient;
  readonly summaryCache?: FoldStateCache<TraceSummaryState>;
  readonly analyticsCache?: FoldStateCache<TraceAnalyticsState>;
  readonly metrics?: Metrics;

  /** Absent means this deployment writes no fallback origin at all. */
  readonly originGate?: OriginGateDispatchDeps;
  /** Absent means no online monitor is ever triggered from this pipeline. */
  readonly evaluationTrigger?: EvaluationTriggerDispatchDeps;
  /** Absent means an SDK-run custom evaluation is never reported. */
  readonly customEvaluationSync?: CustomEvaluationSyncDispatchDeps;
  /** Span ingest is the busiest billable stream; absent means it pokes nothing. */
  readonly billingPoke?: { handle(event: { tenantId: string }): Promise<void> };
  readonly graphTriggerActivity?: GraphTriggerActivityPorts;
  readonly codingAgentSpanFacts?: Omit<SpanFactsBridgeDeps, "eventTypes">;
  readonly projectMetadata?: ProjectMetadataPorts;
  /** Re-asserts a project's clustering schedule on every real ingest. */
  readonly bootstrapTopicClustering?: (projectId: string) => Promise<void>;
  readonly broadcast?: TraceProcessingBroadcastPorts;
  readonly ee?: TraceProcessingEnterpriseDeps;
}

const ANALYTICS_READ_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** The chain shape every optional-mount helper below threads through —
 * fixed to this pipeline's own name, prefix and vocabulary, never generic. */
type TraceChain = PipelineChainWithId<
  typeof TRACE_PIPELINE_NAME,
  typeof TRACE_PIPELINE_PREFIX,
  typeof traceEvents
>;

/** The three durable-write process managers: every one is optional, and a
 * deployment without a dep for it simply runs without that guarantee. */
function mountProcessManagers(
  chain: TraceChain,
  deps: TraceProcessingPipelineDeps,
): TraceChain {
  let next = chain;
  if (deps.originGate) {
    next = next.withProcessManager(ORIGIN_GATE_PROCESS_NAME, {
      state: originGateStateSchema,
      init: initOriginGateState,
      intents: originGateIntents(deps.originGate),
      on: originGateOn,
      onWake: originGateOnWake,
    });
  }
  if (deps.evaluationTrigger) {
    next = next.withProcessManager(EVALUATION_TRIGGER_PROCESS_NAME, {
      state: evaluationTriggerStateSchema,
      init: initEvaluationTriggerState,
      intents: requestEvaluationsIntents(deps.evaluationTrigger),
      on: evaluationTriggerOn,
      onWake: evaluationTriggerOnWake,
    });
  }
  if (deps.customEvaluationSync) {
    next = next.withProcessManager(CUSTOM_EVALUATION_SYNC_PROCESS_NAME, {
      state: customEvaluationSyncStateSchema,
      init: initCustomEvaluationSyncState,
      intents: reportEvaluationsIntents(deps.customEvaluationSync),
      on: customEvaluationSyncOn,
    });
  }
  return next;
}

/** The cross-pipeline-authored subscribers (ADR-107 decision 13): each is a
 * standalone factory, mounted here natively against this pipeline's own
 * vocabulary rather than through the pre-built path, since none of them
 * needs a field `HandlerContext` cannot supply. */
function mountCrossPipelineSubscribers(
  chain: TraceChain,
  deps: TraceProcessingPipelineDeps,
): TraceChain {
  let next = chain;
  if (deps.billingPoke) {
    const billingPoke = deps.billingPoke;
    next = next.withSubscriber("billingMeterPoke", {
      on: {
        spanReceived: (_data, ctx) =>
          billingPoke.handle({ tenantId: ctx.tenantId }),
      },
    });
  }
  if (deps.graphTriggerActivity) {
    const subscriber = createGraphTriggerActivitySubscriber({
      eventTypes: ["spanReceived", "originResolved"],
      ports: deps.graphTriggerActivity,
    });
    next = next.withSubscriber("graphTriggerActivity", {
      on: {
        spanReceived: (data, ctx) =>
          subscriber.handle(
            {
              type: "spanReceived",
              tenantId: ctx.tenantId,
              occurredAt: data.occurredAt,
            },
            { tenantId: ctx.tenantId },
          ),
        originResolved: (_data, ctx) =>
          subscriber.handle(
            {
              type: "originResolved",
              tenantId: ctx.tenantId,
              occurredAt: ctx.now,
            },
            { tenantId: ctx.tenantId },
          ),
      },
    });
  }
  if (deps.codingAgentSpanFacts) {
    const bridge = createSpanFactsBridge({
      ...deps.codingAgentSpanFacts,
      eventTypes: ["spanReceived"],
    });
    next = next.withSubscriber("codingAgentSpanFactsDispatch", {
      on: {
        spanReceived: (data, ctx) =>
          bridge.handle({
            type: "spanReceived",
            tenantId: ctx.tenantId,
            occurredAt: data.occurredAt,
            data,
          }),
      },
    });
  }
  return next;
}

/** Onboarding: the one-time metadata latch and the perpetual clustering
 * re-assertion, both native subscribers on the same ingest signals. */
function mountOnboardingSubscribers(
  chain: TraceChain,
  deps: TraceProcessingPipelineDeps,
): TraceChain {
  let next = chain;
  if (deps.projectMetadata) {
    const projects = deps.projectMetadata;
    next = next.withSubscriber("projectMetadata", {
      on: {
        spanReceived: (data, ctx) =>
          applyProjectMetadata(
            projects,
            ingestSignalsFromSpan(data),
            ctx.tenantId,
          ),
      },
    });
  }
  if (deps.bootstrapTopicClustering) {
    const bootstrap = deps.bootstrapTopicClustering;
    next = next.withSubscriber("topicClusteringBootstrap", {
      on: {
        spanReceived: (data, ctx) => {
          if (isSampleIngest(ingestSignalsFromSpan(data))) return;
          return bootstrap(ctx.tenantId);
        },
        originResolved: (_data, ctx) => bootstrap(ctx.tenantId),
      },
    });
  }
  return next;
}

/** At-most-once SSE nudges — never durable, never replayed. */
function mountBroadcastSubscribers(
  chain: TraceChain,
  deps: TraceProcessingPipelineDeps,
): TraceChain {
  if (!deps.broadcast) return chain;
  const broadcast = deps.broadcast;
  const nudge = (tenantId: string, traceId: string, event: string) =>
    broadcast.broadcastToTenant(
      tenantId,
      JSON.stringify({ event, traceId }),
      "trace_updated",
    );

  return chain
    .withSubscriber("traceUpdateBroadcast", {
      on: {
        spanReceived: (data, ctx) =>
          nudge(ctx.tenantId, data.traceId, "trace_summary_updated"),
        topicAssigned: (data, ctx) =>
          nudge(ctx.tenantId, data.traceId, "trace_summary_updated"),
        originResolved: (data, ctx) =>
          nudge(ctx.tenantId, data.traceId, "trace_summary_updated"),
        annotationAdded: (data, ctx) =>
          nudge(ctx.tenantId, data.traceId, "trace_summary_updated"),
        annotationRemoved: (data, ctx) =>
          nudge(ctx.tenantId, data.traceId, "trace_summary_updated"),
        traceNameChanged: (data, ctx) =>
          nudge(ctx.tenantId, data.traceId, "trace_summary_updated"),
      },
    })
    .withSubscriber("spanStorageBroadcast", {
      on: {
        spanReceived: (data, ctx) =>
          nudge(ctx.tenantId, data.traceId, "span_stored"),
      },
    });
}

/** The five pre-built enterprise members (ADR-107 decision 17), injected by
 * the composition root — this file never imports `ee/`. */
function mountEnterpriseMembers(
  chain: TraceChain,
  deps: TraceProcessingPipelineDeps,
): TraceChain {
  let next = chain;
  if (deps.ee?.traceAlertTriggerMatch) {
    next = next.withSubscriber(
      "traceAlertTriggerMatch",
      deps.ee.traceAlertTriggerMatch,
    );
  }
  if (deps.ee?.virtualKeyLastUsed) {
    next = next.withSubscriber(
      "virtualKeyLastUsed",
      deps.ee.virtualKeyLastUsed,
    );
  }
  if (deps.ee?.gatewayBudgetDebits) {
    const { map, mount } = deps.ee.gatewayBudgetDebits;
    next = next.withMap("gatewayBudgetDebits", map, mount);
  }
  if (deps.ee?.governanceKpis) {
    const { map, mount } = deps.ee.governanceKpis;
    next = next.withMap("governanceKpis", map, mount);
  }
  if (deps.ee?.governanceOcsfEvents) {
    const { map, mount } = deps.ee.governanceOcsfEvents;
    next = next.withMap("governanceOcsfEvents", map, mount);
  }
  return next;
}

function buildStores(deps: TraceProcessingPipelineDeps) {
  const summaryStore = clickhouseReplacing({
    client: deps.client,
    table: traceSummariesTable,
    version: TRACE_SUMMARY_STATE_VERSION,
    key: "TraceId",
    stateVersionColumn: "Version",
    row: traceSummaryRowMapping,
    cache: deps.summaryCache ?? noFoldStateCache<TraceSummaryState>(),
    retentionDays: DEFAULT_RETENTION_DAYS,
  });
  assertMountIsLegal("traceSummary", traceSummaryMount(summaryStore));

  const analyticsStore = clickhouseReplacing({
    client: deps.client,
    table: traceAnalyticsTable,
    version: TRACE_ANALYTICS_STATE_VERSION,
    key: "TraceId",
    stateVersionColumn: "Version",
    row: traceAnalyticsRowMapping,
    cache: deps.analyticsCache ?? noFoldStateCache<TraceAnalyticsState>(),
    retentionDays: DEFAULT_RETENTION_DAYS,
    // Deployed `ORDER BY (TenantId, OccurredAt, TraceId)` is time-leading.
    readWindow: { column: "OccurredAt", lookbackMs: ANALYTICS_READ_WINDOW_MS },
  });
  assertMountIsLegal("traceAnalytics", traceAnalyticsMount(analyticsStore));

  const spansStore = clickhouseAppend<
    StoredSpanRecord,
    typeof storedSpansTable.columns
  >({
    client: deps.client,
    table: storedSpansTable,
    toRow: toStoredSpanRow,
  });
  assertMountIsLegal("spanStorage", spanStorageMount(spansStore));

  return { summaryStore, analyticsStore, spansStore };
}

export function createTraceProcessingPipeline(
  deps: TraceProcessingPipelineDeps,
) {
  const { summaryStore, analyticsStore, spansStore } = buildStores(deps);

  let chain = definePipeline(TRACE_PIPELINE_NAME)
    .prefix(TRACE_PIPELINE_PREFIX)
    .events(traceEvents)
    .id({
      spanReceived: (d) => d.traceId,
      topicAssigned: (d) => d.traceId,
      originResolved: (d) => d.traceId,
      annotationAdded: (d) => d.traceId,
      annotationRemoved: (d) => d.traceId,
      annotationsBulkSynced: (d) => d.traceId,
      traceNameChanged: (d) => d.traceId,
      logContributed: (d) => d.traceId,
      metricDataPointCorrelated: (d) => d.traceId,
    })

    .withCommand("recordSpan", {
      input: canonicalSpanSchema,
      handle: recordSpan,
    })
    .withCommand("assignTopic", {
      input: topicAssignmentSchema,
      handle: assignTopic,
    })
    .withCommand("resolveOrigin", {
      input: originResolutionSchema,
      handle: resolveOrigin,
    })
    .withCommand("addAnnotation", {
      input: annotationRefSchema,
      handle: addAnnotation,
    })
    .withCommand("removeAnnotation", {
      input: annotationRefSchema,
      handle: removeAnnotation,
    })
    .withCommand("bulkSyncAnnotations", {
      input: annotationsBulkSyncSchema,
      handle: bulkSyncAnnotations,
    })
    .withCommand("changeTraceName", {
      input: traceNameChangeSchema,
      handle: changeTraceName,
    })
    .withCommand("recordLogContribution", {
      input: logContributionSchema,
      handle: recordLogContribution,
    })
    .withCommand("recordMetricCorrelation", {
      input: metricCorrelationSchema,
      handle: recordMetricCorrelation,
    })

    .withFold("traceSummary", {
      state: traceSummaryStateSchema,
      init: initTraceSummaryState,
      pin: TRACE_SUMMARY_STATE_VERSION,
      on: {
        spanReceived: summaryHandleSpanReceived,
        topicAssigned: summaryHandleTopicAssigned,
        originResolved: summaryHandleOriginResolved,
        annotationAdded: summaryHandleAnnotationAdded,
        annotationRemoved: summaryHandleAnnotationRemoved,
        annotationsBulkSynced: summaryHandleAnnotationsBulkSynced,
        traceNameChanged: summaryHandleTraceNameChanged,
        logContributed: handleLogContributed,
        metricDataPointCorrelated: handleMetricDataPointCorrelated,
      },
      store: summaryStore,
    })

    .withFold("traceAnalytics", {
      state: traceAnalyticsStateSchema,
      init: initTraceAnalyticsState,
      pin: TRACE_ANALYTICS_STATE_VERSION,
      on: {
        spanReceived: analyticsHandleSpanReceived,
        topicAssigned: analyticsHandleTopicAssigned,
        originResolved: analyticsHandleOriginResolved,
        annotationAdded: analyticsHandleAnnotationAdded,
        annotationRemoved: analyticsHandleAnnotationRemoved,
        annotationsBulkSynced: analyticsHandleAnnotationsBulkSynced,
        traceNameChanged: analyticsHandleTraceNameChanged,
      },
      store: analyticsStore,
    })

    .withMap("spanStorage", {
      on: { spanReceived: mapSpanReceived },
      store: spansStore,
    });

  chain = mountProcessManagers(chain, deps);
  chain = mountCrossPipelineSubscribers(chain, deps);
  chain = mountOnboardingSubscribers(chain, deps);
  chain = mountBroadcastSubscribers(chain, deps);
  chain = mountEnterpriseMembers(chain, deps);

  return chain.build({ metrics: deps.metrics });
}
