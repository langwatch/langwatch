import {
    type ClickHouseClient,
    clickhouseAppend,
    clickhouseReplacing,
    type FoldStateCache,
} from "@langwatch/clickhouse";
import {
    ConfigurationError,
    definePipeline,
    validateMount,
    type AppendStore,
    type GroupKey,
    type Metrics,
    type Mount,
    type ReplaceStore,
} from "@langwatch/event-sourcing";
import { addAnnotation } from "./addAnnotation.command";
import { assignTopic } from "./assignTopic.command";
import { bulkSyncAnnotations } from "./bulkSyncAnnotations.command";
import { changeTraceName } from "./changeTraceName.command";
import { TRACE_PIPELINE_NAME, TRACE_PIPELINE_PREFIX, traceEvents } from "./events";
import { recordLogContribution } from "./recordLogContribution.command";
import { recordMetricCorrelation } from "./recordMetricCorrelation.command";
import { recordSpan } from "./recordSpan.command";
import { removeAnnotation } from "./removeAnnotation.command";
import { resolveOrigin } from "./resolveOrigin.command";
import {
    annotationRefSchema,
    annotationsBulkSyncSchema,
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
import { storedSpansTable, traceAnalyticsTable, traceSummariesTable } from "./table";
import {
    initTraceAnalyticsState,
    traceAnalyticsRowMapping,
    traceAnalyticsStateSchema,
    TRACE_ANALYTICS_STATE_VERSION,
    handleAnnotationAdded as analyticsHandleAnnotationAdded,
    handleAnnotationRemoved as analyticsHandleAnnotationRemoved,
    handleAnnotationsBulkSynced as analyticsHandleAnnotationsBulkSynced,
    handleOriginResolved as analyticsHandleOriginResolved,
    handleSpanReceived as analyticsHandleSpanReceived,
    handleTopicAssigned as analyticsHandleTopicAssigned,
    handleTraceNameChanged as analyticsHandleTraceNameChanged,
    type TraceAnalyticsState,
} from "./traceAnalytics.projection";
import {
    handleAnnotationAdded as summaryHandleAnnotationAdded,
    handleAnnotationRemoved as summaryHandleAnnotationRemoved,
    handleAnnotationsBulkSynced as summaryHandleAnnotationsBulkSynced,
    handleLogContributed,
    handleMetricDataPointCorrelated,
    handleOriginResolved as summaryHandleOriginResolved,
    handleSpanReceived as summaryHandleSpanReceived,
    handleTopicAssigned as summaryHandleTopicAssigned,
    handleTraceNameChanged as summaryHandleTraceNameChanged,
    initTraceSummaryState,
    traceSummaryRowMapping,
    traceSummaryStateSchema,
    TRACE_SUMMARY_STATE_VERSION,
    type TraceSummaryState,
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
export function traceSummaryMount(store: ReplaceStore<TraceSummaryState>): Mount {
  return { projection: "fold", store: store.kind, scope: "aggregate", collapse: "batch" };
}

export function traceAnalyticsMount(store: ReplaceStore<TraceAnalyticsState>): Mount {
  return { projection: "fold", store: store.kind, scope: "aggregate", collapse: "batch" };
}

/**
 * One lane per span event. `collapse: none` because an event-scoped lane can
 * never gather a batch; many such lanes still coalesce into one insert via
 * the store's own bulk write.
 */
export function spanStorageMount(store: AppendStore<StoredSpanRecord>): Mount {
  return { projection: "map", store: store.kind, scope: "event", collapse: "none" };
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

export interface TraceProcessingPipelineDeps {
  readonly client: ClickHouseClient;
  readonly summaryCache?: FoldStateCache<TraceSummaryState>;
  readonly analyticsCache?: FoldStateCache<TraceAnalyticsState>;
  readonly metrics?: Metrics;
}

export function createTraceProcessingPipeline(deps: TraceProcessingPipelineDeps) {
  const summaryStore = clickhouseReplacing({
    client: deps.client,
    table: traceSummariesTable,
    version: TRACE_SUMMARY_STATE_VERSION,
    key: "TraceId",
    stateVersionColumn: "Version",
    row: traceSummaryRowMapping,
    cache: deps.summaryCache,
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
    cache: deps.analyticsCache,
    retentionDays: DEFAULT_RETENTION_DAYS,
  });
  assertMountIsLegal("traceAnalytics", traceAnalyticsMount(analyticsStore));

  const spansStore = clickhouseAppend<StoredSpanRecord, typeof storedSpansTable.columns>({
    client: deps.client,
    table: storedSpansTable,
    toRow: toStoredSpanRow,
  });
  assertMountIsLegal("spanStorage", spanStorageMount(spansStore));

  return definePipeline(TRACE_PIPELINE_NAME)
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

    .withCommand("recordSpan", { input: canonicalSpanSchema, handle: recordSpan })
    .withCommand("assignTopic", { input: topicAssignmentSchema, handle: assignTopic })
    .withCommand("resolveOrigin", { input: originResolutionSchema, handle: resolveOrigin })
    .withCommand("addAnnotation", { input: annotationRefSchema, handle: addAnnotation })
    .withCommand("removeAnnotation", { input: annotationRefSchema, handle: removeAnnotation })
    .withCommand("bulkSyncAnnotations", {
      input: annotationsBulkSyncSchema,
      handle: bulkSyncAnnotations,
    })
    .withCommand("changeTraceName", { input: traceNameChangeSchema, handle: changeTraceName })
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

    .withMap("spanStorage", { on: { spanReceived: mapSpanReceived }, store: spansStore })

    .build({ metrics: deps.metrics });
}
