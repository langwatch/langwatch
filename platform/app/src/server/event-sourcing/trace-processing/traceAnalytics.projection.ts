import type { RowMapping } from "@langwatch/clickhouse";
import { z } from "zod";
import {
  applyOriginSpan,
  extractOriginSignals,
  initOriginState,
  resolveOrigin,
} from "./originClassification";
import type {
  AnnotationRef,
  AnnotationsBulkSync,
  CanonicalSpan,
  OriginResolution,
  TopicAssignment,
  TraceNameChange,
} from "./schema";
import {
  applyAnnotationBulkSync,
  applyAnnotationChange,
  attributeValues,
  emptyAnnotationState,
  isRootSpan,
  laterStampWins,
  mergeAttribute,
  mergeModelUsage,
  mergeNameCandidate,
  mergeTimeSpan,
  orderedModels,
  presentAnnotationIds,
  spanType as spanTypeOf,
  topicKey,
} from "./spanDerivation";
import type { TraceAnalyticsRow, traceAnalyticsTable } from "./table";

/**
 * The `traceAnalytics` fold: the dimensions a dashboard filters and groups on,
 * ADR-099's slim sibling of `traceSummary`. Neither fold imports the other, and
 * neither holds a measure — those are `totals.ts`'s query (ADR-103).
 */

/**
 * Pinned to the version already stamped on every live `trace_analytics` row
 * (`event-sourcing.old/pipelines/trace-processing/projections/traceAnalytics.foldProjection.ts`'s
 * `TRACE_ANALYTICS_PROJECTION_VERSION_LATEST`), per ADR-105 decision 9.
 */
export const TRACE_ANALYTICS_STATE_VERSION = "2026-07-29";

const LABELS_ATTR = "langwatch.labels";
const ORIGIN_ATTR = "langwatch.origin";
const USER_ID_ATTR = "langwatch.user_id";
const THREAD_ID_ATTR = "langwatch.thread_id";
const CUSTOMER_ID_ATTR = "langwatch.customer_id";

const nameCandidateSchema = z.object({
  spanId: z.string(),
  startTimeMs: z.number(),
  name: z.string(),
  spanType: z.string().nullable(),
});

const originStateSchema = z.object({
  rootOriginSpanId: z.string().nullable(),
  rootOrigin: z.string().nullable(),
  nonRootOriginSpanId: z.string().nullable(),
  nonRootOrigin: z.string().nullable(),
  hasEvaluationScope: z.boolean(),
  hasScenarioScope: z.boolean(),
  hasOptimizationStudioPlatform: z.boolean(),
  hasScenarioRunnerLabel: z.boolean(),
  hasScenarioLabelsResource: z.boolean(),
  hasEvaluationRunId: z.boolean(),
  metadataPlatform: z.string().nullable(),
  metadataPlatformSpanId: z.string().nullable(),
});

export const traceAnalyticsStateSchema = z.object({
  traceId: z.string(),

  /** Running minimum of span starts, and the row's partition anchor. */
  earliestSpanStartMs: z.number(),
  totalDurationMs: z.number(),
  timeToFirstTokenMs: z.number().nullable(),

  rootCandidate: nameCandidateSchema.nullable(),
  fallbackCandidate: nameCandidateSchema.nullable(),
  traceNameOverride: z.string().nullable(),
  traceNameChangedAt: z.number(),

  topicId: z.string().nullable(),
  subTopicId: z.string().nullable(),
  topicAssignedAt: z.number(),

  hasError: z.boolean(),
  modelUsage: z.map(z.string(), z.number()),

  annotations: z.object({
    changes: z.map(
      z.string(),
      z.object({ present: z.boolean(), actedAt: z.number() }),
    ),
    sync: z
      .object({ ids: z.array(z.string()), actedAt: z.number() })
      .nullable(),
  }),
  attributes: z.map(
    z.string(),
    z.object({ value: z.string(), spanId: z.string() }),
  ),
  labels: z.set(z.string()),

  origin: originStateSchema,
});

export type TraceAnalyticsState = z.infer<typeof traceAnalyticsStateSchema>;

export function initTraceAnalyticsState(): TraceAnalyticsState {
  return {
    traceId: "",
    earliestSpanStartMs: 0,
    totalDurationMs: 0,
    timeToFirstTokenMs: null,
    rootCandidate: null,
    fallbackCandidate: null,
    traceNameOverride: null,
    traceNameChangedAt: 0,
    topicId: null,
    subTopicId: null,
    topicAssignedAt: 0,
    hasError: false,
    modelUsage: new Map(),
    annotations: emptyAnnotationState(),
    attributes: new Map(),
    labels: new Set(),
    origin: initOriginState(),
  };
}

export function handleSpanReceived(
  state: TraceAnalyticsState,
  span: CanonicalSpan,
): TraceAnalyticsState {
  const extent = mergeTimeSpan(
    { startMs: state.earliestSpanStartMs, durationMs: state.totalDurationMs },
    span,
  );

  let attributes = state.attributes;
  for (const [key, value] of Object.entries(span.attributes)) {
    if (key === LABELS_ATTR || key.startsWith("langwatch.reserved.")) continue;
    attributes = mergeAttribute(attributes, key, String(value), span.spanId);
  }

  let labels = state.labels;
  const rawLabels = span.attributes[LABELS_ATTR];
  if (Array.isArray(rawLabels)) {
    labels = new Set(labels);
    for (const label of rawLabels) {
      if (typeof label === "string") labels.add(label);
    }
  }

  const candidate = span.name
    ? {
        spanId: span.spanId,
        startTimeMs: span.startTimeUnixMs,
        name: span.name,
        spanType: spanTypeOf(span),
      }
    : null;

  return {
    ...state,
    traceId: state.traceId || span.traceId,
    earliestSpanStartMs: extent.startMs,
    totalDurationMs: extent.durationMs,
    timeToFirstTokenMs:
      span.timeToFirstTokenMs === null
        ? state.timeToFirstTokenMs
        : state.timeToFirstTokenMs === null
          ? span.timeToFirstTokenMs
          : Math.min(state.timeToFirstTokenMs, span.timeToFirstTokenMs),
    rootCandidate: isRootSpan(span)
      ? mergeNameCandidate(state.rootCandidate, candidate)
      : state.rootCandidate,
    fallbackCandidate: isRootSpan(span)
      ? state.fallbackCandidate
      : mergeNameCandidate(state.fallbackCandidate, candidate),
    hasError: state.hasError || span.statusCode === "ERROR",
    modelUsage: span.model
      ? mergeModelUsage(state.modelUsage, span.model, span.startTimeUnixMs)
      : state.modelUsage,
    attributes,
    labels,
    origin: applyOriginSpan(state.origin, extractOriginSignals(span)),
  };
}

export function handleTopicAssigned(
  state: TraceAnalyticsState,
  data: TopicAssignment,
): TraceAnalyticsState {
  const wins = laterStampWins(
    {
      stamp: state.topicAssignedAt,
      value: topicKey(state.topicId, state.subTopicId),
    },
    { stamp: data.assignedAt, value: topicKey(data.topicId, data.subtopicId) },
  );
  if (!wins) return state;
  return {
    ...state,
    topicId: data.topicId,
    subTopicId: data.subtopicId,
    topicAssignedAt: data.assignedAt,
  };
}

export function handleOriginResolved(
  state: TraceAnalyticsState,
  data: OriginResolution,
): TraceAnalyticsState {
  return {
    ...state,
    origin: applyOriginSpan(state.origin, {
      spanId: `origin-resolved:${data.traceId}`,
      isRoot: true,
      explicitOrigin: data.origin,
    }),
  };
}

export function handleAnnotationAdded(
  state: TraceAnalyticsState,
  data: AnnotationRef,
): TraceAnalyticsState {
  return {
    ...state,
    annotations: applyAnnotationChange(
      state.annotations,
      data.annotationId,
      true,
      data.actedAt,
    ),
  };
}

export function handleAnnotationRemoved(
  state: TraceAnalyticsState,
  data: AnnotationRef,
): TraceAnalyticsState {
  return {
    ...state,
    annotations: applyAnnotationChange(
      state.annotations,
      data.annotationId,
      false,
      data.actedAt,
    ),
  };
}

export function handleAnnotationsBulkSynced(
  state: TraceAnalyticsState,
  data: AnnotationsBulkSync,
): TraceAnalyticsState {
  return {
    ...state,
    annotations: applyAnnotationBulkSync(
      state.annotations,
      data.annotationIds,
      data.actedAt,
    ),
  };
}

export function handleTraceNameChanged(
  state: TraceAnalyticsState,
  data: TraceNameChange,
): TraceAnalyticsState {
  const wins = laterStampWins(
    { stamp: state.traceNameChangedAt, value: state.traceNameOverride ?? "" },
    { stamp: data.changedAt, value: data.newName },
  );
  if (!wins) return state;
  return {
    ...state,
    traceNameOverride: data.newName,
    traceNameChangedAt: data.changedAt,
  };
}

export interface TraceAnalyticsView {
  readonly traceId: string;
  readonly earliestSpanStartMs: number;
  readonly totalDurationMs: number;
  readonly timeToFirstTokenMs: number | null;
  readonly traceName: string;
  readonly topicId: string | null;
  readonly subTopicId: string | null;
  readonly userId: string | null;
  readonly conversationId: string | null;
  readonly customerId: string | null;
  readonly origin: string | null;
  readonly models: readonly string[];
  readonly labels: readonly string[];
  readonly hasError: boolean;
  readonly hasAnnotation: boolean;
  readonly annotationIds: readonly string[];
  readonly attributes: Record<string, string>;
  readonly rootSpanStartTimeMs: number | null;
  readonly traceNameFromFallback: boolean;
}

export function deriveTraceAnalyticsView(
  state: TraceAnalyticsState,
): TraceAnalyticsView {
  const rootOrFallback = state.rootCandidate ?? state.fallbackCandidate;
  const attributes = attributeValues(state.attributes);
  const origin = resolveOrigin(state.origin);
  if (origin !== null) attributes[ORIGIN_ATTR] = origin;
  const annotationIds = presentAnnotationIds(state.annotations);

  return {
    traceId: state.traceId,
    earliestSpanStartMs: state.earliestSpanStartMs,
    totalDurationMs: state.totalDurationMs,
    timeToFirstTokenMs: state.timeToFirstTokenMs,
    traceName: state.traceNameOverride ?? rootOrFallback?.name ?? "",
    topicId: state.topicId,
    subTopicId: state.subTopicId,
    userId: attributes[USER_ID_ATTR] ?? null,
    conversationId: attributes[THREAD_ID_ATTR] ?? null,
    customerId: attributes[CUSTOMER_ID_ATTR] ?? null,
    origin,
    models: orderedModels(state.modelUsage),
    labels: [...state.labels],
    hasError: state.hasError,
    hasAnnotation: annotationIds.length > 0,
    annotationIds,
    attributes,
    rootSpanStartTimeMs: rootOrFallback?.startTimeMs ?? null,
    traceNameFromFallback:
      state.traceNameOverride === null &&
      state.rootCandidate === null &&
      state.fallbackCandidate !== null,
  };
}

/** The row is the derived view plus the stamps a read-back needs, not a case shift. */
export const traceAnalyticsRowMapping: RowMapping<
  TraceAnalyticsState,
  typeof traceAnalyticsTable.columns
> = {
  toRow(state, context) {
    const view = deriveTraceAnalyticsView(state);
    const anchor = new Date(
      state.earliestSpanStartMs || context.writtenAt.getTime(),
    );
    return {
      TenantId: context.tenantId,
      TraceId: context.key,
      Version: context.version,
      EarliestSpanStartMs: BigInt(Math.max(0, state.earliestSpanStartMs)),
      TotalDurationMs: BigInt(Math.max(0, Math.round(view.totalDurationMs))),
      TimeToFirstTokenMs:
        view.timeToFirstTokenMs === null
          ? null
          : BigInt(Math.max(0, Math.round(view.timeToFirstTokenMs))),
      TraceName: view.traceName,
      TopicId: view.topicId,
      SubTopicId: view.subTopicId,
      TopicAssignedAt: BigInt(Math.max(0, state.topicAssignedAt)),
      TraceNameChangedAt: BigInt(Math.max(0, state.traceNameChangedAt)),
      UserId: view.userId,
      ConversationId: view.conversationId,
      CustomerId: view.customerId,
      Origin: view.origin,
      Models: [...view.models],
      Labels: [...view.labels],
      HasError: view.hasError,
      HasAnnotation: view.hasAnnotation,
      AnnotationIds: [...view.annotationIds],
      AttributesJson: JSON.stringify(view.attributes),
      RootSpanStartTimeMs:
        view.rootSpanStartTimeMs === null
          ? null
          : BigInt(Math.max(0, view.rootSpanStartTimeMs)),
      TraceNameFromFallback: view.traceNameFromFallback,
      OccurredAt: anchor,
      AcceptedAt: anchor,
      UpdatedAt: context.writtenAt,
      _retention_days: context.retentionDays,
    };
  },

  fromRow(row) {
    const base = initTraceAnalyticsState();
    return {
      ...base,
      traceId: row.TraceId,
      earliestSpanStartMs: Number(row.EarliestSpanStartMs),
      totalDurationMs: Number(row.TotalDurationMs),
      timeToFirstTokenMs:
        row.TimeToFirstTokenMs === null ? null : Number(row.TimeToFirstTokenMs),
      rootCandidate: row.TraceNameFromFallback ? null : rehydrateName(row),
      fallbackCandidate: row.TraceNameFromFallback ? rehydrateName(row) : null,
      traceNameOverride:
        row.TraceNameChangedAt > 0n ? row.TraceName : base.traceNameOverride,
      traceNameChangedAt: Number(row.TraceNameChangedAt),
      topicId: row.TopicId,
      subTopicId: row.SubTopicId,
      topicAssignedAt: Number(row.TopicAssignedAt),
      hasError: row.HasError,
      // Rank order is lost on read-back; models reseed newest-first by their
      // stored order rather than by their original start times.
      modelUsage: new Map(row.Models.map((model, index) => [model, -index])),
      annotations: {
        changes: new Map(
          row.AnnotationIds.map((id) => [id, { present: true, actedAt: 0 }]),
        ),
        sync: null,
      },
      attributes: new Map(
        Object.entries(decodeAttributes(row.AttributesJson)).map(
          ([key, value]) => [key, { value, spanId: "" }],
        ),
      ),
      labels: new Set(row.Labels),
    };
  },
};

function rehydrateName(
  row: TraceAnalyticsRow,
): TraceAnalyticsState["rootCandidate"] {
  if (row.RootSpanStartTimeMs === null) return null;
  return {
    spanId: "",
    startTimeMs: Number(row.RootSpanStartTimeMs),
    name: row.TraceName,
    spanType: null,
  };
}

function decodeAttributes(cell: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(cell);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    // Display data, not identity: a degraded read beats failing the version
    // gate on a row an older build wrote.
    return {};
  }
}
