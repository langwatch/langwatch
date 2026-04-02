import { coerceToNumber } from "~/utils/coerceToNumber";
import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import {
  enrichRagContextIds,
  SpanNormalizationPipelineService,
} from "~/server/app-layer/traces/span-normalization.service";
import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import type { AnalyticsTraceFactData } from "~/server/app-layer/analytics/types";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "~/server/event-sourcing/projections/abstractFoldProjection";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import type {
  LogRecordReceivedEvent,
  MetricRecordReceivedEvent,
  OriginResolvedEvent,
  SpanReceivedEvent,
  TopicAssignedEvent,
} from "../schemas/events";
import {
  spanReceivedEventSchema,
  topicAssignedEventSchema,
  logRecordReceivedEventSchema,
  metricRecordReceivedEventSchema,
  originResolvedEventSchema,
} from "../schemas/events";
import type { NormalizedSpan } from "../schemas/spans";
import {
  extractSpanMetrics,
  extractIdentityAttributes,
} from "./services/spanMetricsExtractor";
import { parseJsonStringArray } from "./services/trace-summary.utils";

export type { AnalyticsTraceFactData };

// ─── Composition root ────────────────────────────────────────────────

const spanNormalizationPipelineService = new SpanNormalizationPipelineService(
  new CanonicalizeSpanAttributesService(),
);

// ─── Known semconv keys to omit from metadata ───────────────────────

/**
 * Attribute keys that are already extracted as top-level columns or are
 * internal/structural. These are omitted from the `metadata` Map to avoid
 * duplication and keep the analytics table lean.
 */
const METADATA_OMIT_PREFIXES = [
  "gen_ai.",
  "langwatch.",
  "error.",
  "exception.",
  "traceloop.",
  "openinference.",
  "ai.",
  "llm.",
  "span.",
  "otel.",
  "status.",
  "output.",
  "input.",
  "mastra.",
  "telemetry.",
  "service.",
  "host.",
  "process.",
  "os.",
  "container.",
  "k8s.",
  "cloud.",
  "deployment.",
  "device.",
  "faas.",
  "webengine.",
  "scenario.",
  "type",
  "operation.name",
  "agent.name",
  "system.name",
  "retrieval.documents",
  "raw_input",
] as const;

const MAX_METADATA_VALUE_LENGTH = 256;

// ─── Helpers ─────────────────────────────────────────────────────────

function shouldOmitMetadataKey(key: string): boolean {
  for (const prefix of METADATA_OMIT_PREFIXES) {
    if (key === prefix || key.startsWith(prefix)) return true;
  }
  return false;
}

function extractMetadataFromSpan(span: NormalizedSpan): Record<string, string> {
  const metadata: Record<string, string> = {};

  // Include metadata.* attributes from span attributes (custom user metadata)
  for (const [key, value] of Object.entries(span.spanAttributes)) {
    if (!key.startsWith("metadata.")) continue;
    const strValue = typeof value === "string" ? value : String(value ?? "");
    if (strValue.length <= MAX_METADATA_VALUE_LENGTH) {
      metadata[key] = strValue;
    }
  }

  // Include non-standard resource attributes as metadata
  for (const [key, value] of Object.entries(span.resourceAttributes)) {
    if (shouldOmitMetadataKey(key)) continue;
    const strValue = typeof value === "string" ? value : String(value ?? "");
    if (strValue.length <= MAX_METADATA_VALUE_LENGTH) {
      metadata[key] = strValue;
    }
  }

  return metadata;
}

function extractLabelsFromSpan(span: NormalizedSpan): string[] {
  const labels = span.spanAttributes[ATTR_KEYS.LANGWATCH_LABELS];
  if (typeof labels === "string") {
    return parseJsonStringArray(labels);
  }
  if (Array.isArray(labels)) {
    return labels.filter((l): l is string => typeof l === "string");
  }
  return [];
}

function extractRagDocuments(span: NormalizedSpan): {
  ragDocumentIds: string[];
  ragDocumentContents: string[];
} {
  const raw =
    span.spanAttributes[ATTR_KEYS.LANGWATCH_RAG_CONTEXTS] ??
    span.spanAttributes[ATTR_KEYS.LANGWATCH_RAG_CONTEXTS_LEGACY];

  if (!Array.isArray(raw)) return { ragDocumentIds: [], ragDocumentContents: [] };

  const ids: string[] = [];
  const contents: string[] = [];

  for (const ctx of raw) {
    if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) continue;
    const ctxObj = ctx as Record<string, unknown>;
    const docId = ctxObj.document_id;
    const content = ctxObj.content;
    if (typeof docId === "string") ids.push(docId);
    else ids.push("");
    if (typeof content === "string") contents.push(content);
    else if (content !== undefined && content !== null)
      contents.push(String(content));
    else contents.push("");
  }

  return { ragDocumentIds: ids, ragDocumentContents: contents };
}

function extractSpanEvents(span: NormalizedSpan): {
  eventTypes: string[];
  eventScoreKeys: string[];
  eventScoreValues: number[];
  eventDetailKeys: string[];
  eventDetailValues: string[];
  thumbsUpDownVote: number | null;
} {
  const eventTypes: string[] = [];
  const eventScoreKeys: string[] = [];
  const eventScoreValues: number[] = [];
  const eventDetailKeys: string[] = [];
  const eventDetailValues: string[] = [];
  let thumbsUpDownVote: number | null = null;

  if (!span.events?.length) {
    return {
      eventTypes,
      eventScoreKeys,
      eventScoreValues,
      eventDetailKeys,
      eventDetailValues,
      thumbsUpDownVote,
    };
  }

  for (const event of span.events) {
    eventTypes.push(event.name);

    const attrs = event.attributes ?? {};

    // Extract score metrics from event attributes
    for (const [key, value] of Object.entries(attrs)) {
      const numValue = coerceToNumber(value);
      if (
        numValue !== null &&
        (key.startsWith("event.metrics.") ||
          key === "vote" ||
          key === "score" ||
          key === "gen_ai.evaluation.score.value")
      ) {
        eventScoreKeys.push(key);
        eventScoreValues.push(numValue);
      }
    }

    // Extract detail values from event attributes
    for (const [key, value] of Object.entries(attrs)) {
      if (
        typeof value === "string" &&
        (key === "feedback" ||
          key === "comment" ||
          key === "gen_ai.evaluation.score.label")
      ) {
        eventDetailKeys.push(key);
        eventDetailValues.push(value);
      }
    }

    // Extract thumbs up/down vote
    if (event.name === "thumbs_up_down") {
      const vote = coerceToNumber(attrs["vote"]);
      if (vote !== null) {
        thumbsUpDownVote = vote;
      }
    }
  }

  return {
    eventTypes,
    eventScoreKeys,
    eventScoreValues,
    eventDetailKeys,
    eventDetailValues,
    thumbsUpDownVote,
  };
}

/** @internal Exported for unit testing */
export function applySpanToAnalyticsFacts({
  state,
  span,
}: {
  state: AnalyticsTraceFactData;
  span: NormalizedSpan;
}): AnalyticsTraceFactData {
  // Use shared extractor for metrics consistency with traceSummary
  const metrics = extractSpanMetrics({ timingState: state, span });

  // Accumulate token totals
  const totalPromptTokens =
    (state.totalPromptTokens ?? 0) + metrics.tokens.promptTokens;
  const totalCompletionTokens =
    (state.totalCompletionTokens ?? 0) + metrics.tokens.completionTokens;
  const totalCost = (state.totalCost ?? 0) + metrics.tokens.cost;

  const tokensPerSecond =
    totalCompletionTokens > 0 && metrics.timing.totalDurationMs > 0
      ? Math.round(
          (totalCompletionTokens / metrics.timing.totalDurationMs) * 1000,
        )
      : null;

  let timeToFirstTokenMs = state.timeToFirstTokenMs;
  if (metrics.tokenTiming.timeToFirstToken !== null) {
    timeToFirstTokenMs =
      timeToFirstTokenMs === null
        ? metrics.tokenTiming.timeToFirstToken
        : Math.min(timeToFirstTokenMs, metrics.tokenTiming.timeToFirstToken);
  }

  // Per-model accumulation using shared model extraction
  const model = metrics.models[0];
  let modelNames = [...state.modelNames];
  let modelPromptTokens = [...state.modelPromptTokens];
  let modelCompletionTokens = [...state.modelCompletionTokens];
  let modelCosts = [...state.modelCosts];

  if (
    model &&
    (metrics.tokens.promptTokens > 0 ||
      metrics.tokens.completionTokens > 0 ||
      metrics.tokens.cost > 0)
  ) {
    const existingIndex = modelNames.indexOf(model);
    if (existingIndex >= 0) {
      modelPromptTokens[existingIndex]! += metrics.tokens.promptTokens;
      modelCompletionTokens[existingIndex]! += metrics.tokens.completionTokens;
      modelCosts[existingIndex]! += metrics.tokens.cost;
    } else {
      modelNames = [...modelNames, model];
      modelPromptTokens = [...modelPromptTokens, metrics.tokens.promptTokens];
      modelCompletionTokens = [
        ...modelCompletionTokens,
        metrics.tokens.completionTokens,
      ];
      modelCosts = [...modelCosts, metrics.tokens.cost];
    }
  }

  // Use shared identity extraction for consistency
  const identity = extractIdentityAttributes(span);
  const userId = state.userId || identity.userId;
  const threadId = state.threadId || identity.threadId;
  const customerId = state.customerId || identity.customerId;

  // Labels: union across spans
  const spanLabels = extractLabelsFromSpan(span);
  const labels =
    spanLabels.length > 0
      ? [...new Set([...state.labels, ...spanLabels])]
      : state.labels;

  // Metadata: merge span metadata into existing
  const spanMetadata = extractMetadataFromSpan(span);
  const metadata =
    Object.keys(spanMetadata).length > 0
      ? { ...spanMetadata, ...state.metadata }
      : state.metadata;

  // Events
  const spanEvents = extractSpanEvents(span);

  // RAG documents
  const rag = extractRagDocuments(span);

  return {
    ...state,
    traceId: state.traceId || span.traceId,
    spanCount: state.spanCount + 1,
    occurredAt: metrics.timing.occurredAt,
    totalDurationMs: metrics.timing.totalDurationMs,
    containsError: state.containsError || metrics.status.hasError,

    // Known metadata
    userId,
    threadId,
    customerId,
    labels,
    metadata,

    // Token totals
    totalPromptTokens: totalPromptTokens > 0 ? totalPromptTokens : null,
    totalCompletionTokens:
      totalCompletionTokens > 0 ? totalCompletionTokens : null,
    totalCost: totalCost > 0 ? Number(totalCost.toFixed(6)) : null,
    tokensPerSecond,
    timeToFirstTokenMs,

    // Per-model
    modelNames,
    modelPromptTokens,
    modelCompletionTokens,
    modelCosts,

    // Events: append from this span
    eventTypes: [...state.eventTypes, ...spanEvents.eventTypes],
    eventScoreKeys: [...state.eventScoreKeys, ...spanEvents.eventScoreKeys],
    eventScoreValues: [
      ...state.eventScoreValues,
      ...spanEvents.eventScoreValues,
    ],
    eventDetailKeys: [...state.eventDetailKeys, ...spanEvents.eventDetailKeys],
    eventDetailValues: [
      ...state.eventDetailValues,
      ...spanEvents.eventDetailValues,
    ],
    thumbsUpDownVote: spanEvents.thumbsUpDownVote ?? state.thumbsUpDownVote,

    // RAG
    ragDocumentIds: [...state.ragDocumentIds, ...rag.ragDocumentIds],
    ragDocumentContents: [
      ...state.ragDocumentContents,
      ...rag.ragDocumentContents,
    ],
  };
}

// ─── Fold projection class ──────────────────────────────────────────

const analyticsTraceFactEvents = [
  spanReceivedEventSchema,
  topicAssignedEventSchema,
  logRecordReceivedEventSchema,
  metricRecordReceivedEventSchema,
  originResolvedEventSchema,
] as const;

/**
 * Fold projection that populates the denormalized analytics_trace_facts table.
 *
 * Extracts analytics-relevant fields (userId, threadId, per-model tokens,
 * events, RAG documents, metadata) from trace-processing events into a flat,
 * pre-aggregated row optimized for analytics queries.
 *
 * - `implements FoldEventHandlers` enforces a handler exists for every event schema
 * - Handler names derived from event type strings
 * - `updatedAt` is auto-managed by the base class after each handler call (camelCase)
 */
export class AnalyticsTraceFactsFoldProjection
  extends AbstractFoldProjection<
    AnalyticsTraceFactData,
    typeof analyticsTraceFactEvents
  >
  implements
    FoldEventHandlers<typeof analyticsTraceFactEvents, AnalyticsTraceFactData>
{
  readonly name = "analyticsTraceFacts";
  readonly version = "2026-04-01";
  readonly store: FoldProjectionStore<AnalyticsTraceFactData>;
  protected override readonly timestampStyle = "camel" as const;

  protected readonly events = analyticsTraceFactEvents;

  constructor(deps: { store: FoldProjectionStore<AnalyticsTraceFactData> }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
    return {
      traceId: "",
      occurredAt: 0,

      // Known metadata
      userId: "",
      threadId: "",
      customerId: "",
      labels: [] as string[],
      topicId: null as string | null,
      subTopicId: null as string | null,

      // Dynamic metadata
      metadata: {} as Record<string, string>,

      // Performance
      totalCost: null as number | null,
      totalDurationMs: 0,
      totalPromptTokens: null as number | null,
      totalCompletionTokens: null as number | null,
      tokensPerSecond: null as number | null,
      timeToFirstTokenMs: null as number | null,
      containsError: false,
      hasAnnotation: null as boolean | null,
      spanCount: 0,

      // Per-model (parallel arrays)
      modelNames: [] as string[],
      modelPromptTokens: [] as number[],
      modelCompletionTokens: [] as number[],
      modelCosts: [] as number[],

      // Events (parallel arrays)
      eventTypes: [] as string[],
      eventScoreKeys: [] as string[],
      eventScoreValues: [] as number[],
      eventDetailKeys: [] as string[],
      eventDetailValues: [] as string[],
      thumbsUpDownVote: null as number | null,

      // RAG
      ragDocumentIds: [] as string[],
      ragDocumentContents: [] as string[],
    };
  }

  handleTraceSpanReceived(
    event: SpanReceivedEvent,
    state: AnalyticsTraceFactData,
  ): AnalyticsTraceFactData {
    const normalizedSpan =
      spanNormalizationPipelineService.normalizeSpanReceived(
        event.tenantId,
        event.data.span,
        event.data.resource,
        event.data.instrumentationScope,
      );
    enrichRagContextIds(normalizedSpan);

    return {
      ...applySpanToAnalyticsFacts({ state, span: normalizedSpan }),
      createdAt: state.createdAt,
    };
  }

  handleTraceTopicAssigned(
    event: TopicAssignedEvent,
    state: AnalyticsTraceFactData,
  ): AnalyticsTraceFactData {
    return {
      ...state,
      topicId: event.data.topicId ?? state.topicId,
      subTopicId: event.data.subtopicId ?? state.subTopicId,
    };
  }

  handleTraceLogRecordReceived(
    _event: LogRecordReceivedEvent,
    state: AnalyticsTraceFactData,
  ): AnalyticsTraceFactData {
    // Logs don't affect analytics fact columns
    return state;
  }

  handleTraceMetricRecordReceived(
    event: MetricRecordReceivedEvent,
    state: AnalyticsTraceFactData,
  ): AnalyticsTraceFactData {
    if (event.data.metricName === "gen_ai.server.time_to_first_token") {
      const ttftMs = event.data.value * 1000;
      const timeToFirstTokenMs =
        state.timeToFirstTokenMs === null
          ? ttftMs
          : Math.min(state.timeToFirstTokenMs, ttftMs);
      return { ...state, timeToFirstTokenMs };
    }
    return state;
  }

  handleTraceOriginResolved(
    _event: OriginResolvedEvent,
    state: AnalyticsTraceFactData,
  ): AnalyticsTraceFactData {
    // Origin is not in the analytics schema
    return state;
  }
}
