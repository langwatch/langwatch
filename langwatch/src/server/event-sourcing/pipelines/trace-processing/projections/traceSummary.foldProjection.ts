import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import {
  enrichRagContextIds,
  SpanNormalizationPipelineService,
} from "~/server/app-layer/traces/span-normalization.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { SYNTHETIC_SPAN_NAMES } from "~/server/tracer/constants";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "~/server/event-sourcing/projections/abstractFoldProjection";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import { TRACE_SUMMARY_PROJECTION_VERSION_LATEST } from "../schemas/constants";
import type {
  LogRecordReceivedEvent,
  MetricRecordReceivedEvent,
  OriginResolvedEvent,
  SpanReceivedEvent,
  TopicAssignedEvent,
  AnnotationAddedEvent,
  AnnotationRemovedEvent,
  AnnotationsBulkSyncedEvent,
  TraceNameChangedEvent,
} from "../schemas/events";
import {
  spanReceivedEventSchema,
  topicAssignedEventSchema,
  logRecordReceivedEventSchema,
  metricRecordReceivedEventSchema,
  originResolvedEventSchema,
  annotationAddedEventSchema,
  annotationRemovedEventSchema,
  annotationsBulkSyncedEventSchema,
  traceNameChangedEventSchema,
} from "../schemas/events";
import type { NormalizedSpan } from "../schemas/spans";
import {
  SpanTimingService,
  SpanStatusService,
  SpanCostService,
  TraceOriginService,
  TraceAttributeAccumulationService,
  TraceIOAccumulationService,
  TracePromptAccumulationService,
  TraceNameResolutionService,
  shouldOverrideOutput,
  extractIOFromLogRecord,
  extractClaudeCodeApiRequestMetrics,
  extractCodexSseEventMetrics,
  extractCodexConversationStartMetrics,
  extractGenAiLogMetrics,
  OUTPUT_SOURCE,
} from "./services";

export type { TraceSummaryData };

// 2026-04-28: trim trailing assistant from chat-shaped input
const COMPUTED_IO_SCHEMA_VERSION = "2026-04-28" as const;

const AI_SPAN_TYPES = new Set(["llm", "agent", "tool", "rag"]);

// ─── Main composition ───────────────────────────────────────────────

const spanNormalizationPipelineService = new SpanNormalizationPipelineService(
  new CanonicalizeSpanAttributesService(),
);

const spanTimingService = new SpanTimingService();
const spanStatusService = new SpanStatusService();
const spanCostService = new SpanCostService();
const traceOriginService = new TraceOriginService();
const traceAttributeAccumulationService =
  new TraceAttributeAccumulationService(traceOriginService);
const traceIOExtractionService = new TraceIOExtractionService();
const traceIOAccumulationService = new TraceIOAccumulationService(
  traceIOExtractionService,
);
const tracePromptAccumulationService = new TracePromptAccumulationService();
const traceNameResolutionService = new TraceNameResolutionService();

// ─── Main composition ───────────────────────────────────────────────

/**
 * Max spans we fully process (normalize + derive) into a trace summary. A
 * handful of traces accumulate tens of thousands of spans (reused trace_id,
 * runaway loops); deriving every one pays unbounded cost for no added value.
 * Past the cap we only keep counting so the true magnitude stays visible.
 */
export const MAX_PROCESSED_SPANS = 512;

/** @internal Exported for unit testing */
export function applySpanToSummary({
  state,
  span,
}: {
  state: TraceSummaryData;
  span: NormalizedSpan;
}): TraceSummaryData {
  if (SYNTHETIC_SPAN_NAMES.has(span.name)) {
    // Synthetic spans (e.g. `langwatch.track_event`) must not contribute to
    // timing/cost/I-O -- they don't represent real execution. Their payload
    // (the `/api/track_event` endpoint stuffs the user-tracked event into
    // `span.events`) is still persisted to stored_spans like any other span,
    // so the trace-level events list is derived from there at read time.
    return state;
  }

  const timing = spanTimingService.accumulateTiming({ state, span });
  const tokens = spanCostService.accumulateTokens({
    state,
    span,
    totalDurationMs: timing.totalDurationMs,
  });
  const status = spanStatusService.accumulateStatus({ state, span });
  const io = traceIOAccumulationService.accumulateIO({ state, span });
  const attributes = traceAttributeAccumulationService.accumulateAttributes({
    state,
    span,
    outputSource: io.outputSource,
    inputIsFallback: io.inputIsFallback,
    outputIsFallback: io.outputIsFallback,
  });

  const newModels = spanCostService.extractModelsFromSpan(span);
  const models =
    newModels.length > 0
      ? [...new Set([...state.models, ...newModels])].sort()
      : state.models;

  // Precedence rules for traceName / rootSpanType / rootSpanStartTimeMs
  // live in TraceNameResolutionService — see that file for the full set.
  const {
    traceName,
    rootSpanType,
    rootSpanStartTimeMs,
    traceNameFromFallback,
    rootMetadataFromFallback,
  } = traceNameResolutionService.resolveFromSpan({ state, span });

  const spanType = String(span.spanAttributes[ATTR_KEYS.SPAN_TYPE] ?? "");
  const containsAi = state.containsAi || AI_SPAN_TYPES.has(spanType);

  const promptRollup = tracePromptAccumulationService.accumulate({ state, span });

  return {
    ...state,
    traceId: state.traceId || span.traceId,
    spanCount: state.spanCount + 1,
    computedIOSchemaVersion: COMPUTED_IO_SCHEMA_VERSION,
    occurredAt: timing.occurredAt,
    totalDurationMs: timing.totalDurationMs,
    models,
    traceName,
    traceNameFromFallback,
    rootMetadataFromFallback,
    rootSpanStartTimeMs,
    ...tokens,
    ...status,
    computedInput: io.computedInput,
    computedOutput: io.computedOutput,
    outputFromRootSpan: io.outputFromRootSpan,
    outputSpanEndTimeMs: io.outputSpanEndTimeMs,
    blockedByGuardrail: io.blockedByGuardrail,
    rootSpanType,
    containsAi,
    ...promptRollup,
    attributes,
  };
}

// ─── Fold projection class ──────────────────────────────────────────

const traceSummaryEvents = [
  spanReceivedEventSchema,
  topicAssignedEventSchema,
  logRecordReceivedEventSchema,
  metricRecordReceivedEventSchema,
  originResolvedEventSchema,
  annotationAddedEventSchema,
  annotationRemovedEventSchema,
  annotationsBulkSyncedEventSchema,
  traceNameChangedEventSchema,
] as const;

/**
 * Type-safe fold projection for trace summary state.
 *
 * - `implements FoldEventHandlers` enforces a handler exists for every event schema
 * - Handler names derived from event type strings (e.g. `"lw.obs.trace.span_received"` -> `handleTraceSpanReceived`)
 * - `updatedAt` is auto-managed by the base class after each handler call (camelCase)
 */
export class TraceSummaryFoldProjection
  extends AbstractFoldProjection<TraceSummaryData, typeof traceSummaryEvents, "createdAt", "updatedAt", "LastEventOccurredAt">
  implements FoldEventHandlers<typeof traceSummaryEvents, TraceSummaryData>
{
  readonly name = "traceSummary";
  readonly version = TRACE_SUMMARY_PROJECTION_VERSION_LATEST;
  readonly store: FoldProjectionStore<TraceSummaryData>;

  protected readonly events = traceSummaryEvents;

  constructor(deps: { store: FoldProjectionStore<TraceSummaryData> }) {
    super({ createdAtKey: "createdAt", updatedAtKey: "updatedAt", LastEventOccurredAtKey: "LastEventOccurredAt" });
    this.store = deps.store;
  }

  protected initState() {
    return {
      traceId: "",
      spanCount: 0,
      totalDurationMs: 0,
      computedIOSchemaVersion: COMPUTED_IO_SCHEMA_VERSION,
      computedInput: null,
      computedOutput: null,
      timeToFirstTokenMs: null,
      timeToLastTokenMs: null,
      tokensPerSecond: null,
      containsErrorStatus: false,
      containsOKStatus: false,
      errorMessage: null,
      models: [],
      totalCost: null,
      tokensEstimated: false,
      totalPromptTokenCount: null,
      totalCompletionTokenCount: null,
      outputFromRootSpan: false,
      outputSpanEndTimeMs: 0,
      blockedByGuardrail: false,
      rootSpanType: null,
      containsAi: false,
      containsPrompt: false,
      selectedPromptId: null,
      selectedPromptSpanId: null,
      selectedPromptStartTimeMs: null,
      lastUsedPromptId: null,
      lastUsedPromptVersionNumber: null,
      lastUsedPromptVersionId: null,
      lastUsedPromptSpanId: null,
      lastUsedPromptStartTimeMs: null,
      topicId: null,
      subTopicId: null,
      annotationIds: [],
      traceName: "",
      rootSpanStartTimeMs: undefined,
      traceNameUserOverridden: false,
      traceNameFromFallback: false,
      rootMetadataFromFallback: false,
      attributes: {},
      // events, scenarioRoleCosts/Latencies/Spans and spanCosts are no longer
      // accumulated in the fold state: they scaled O(span-count) and made each
      // fold step O(n) (copy + re-serialize the whole growing blob), so a
      // single long-lived trace turned folding into O(n^2). The trace-level
      // events list and scenario role cost/latency are now derived from
      // stored_spans at read time (events on the trace-detail read, scenario
      // metrics when simulation metrics are computed), keeping all
      // span-count-scaling collections off the hot path entirely.
      // Sentinel: 0 means "no spans received yet". The timing function uses
      // occurredAt > 0 to decide first-span vs min-of-existing. Using Date.now()
      // here would break Math.min logic -- wall-clock time >> span startTimeUnixMs.
      occurredAt: 0,
    };
  }

  handleTraceSpanReceived(
    event: SpanReceivedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    // Past the processing cap, keep counting but skip the expensive
    // normalization + derivation — a runaway trace cannot keep growing the
    // fold cost. Derived fields stay frozen at the first MAX_PROCESSED_SPANS.
    if (state.spanCount >= MAX_PROCESSED_SPANS) {
      return { ...state, spanCount: state.spanCount + 1 };
    }

    const normalizedSpan =
      spanNormalizationPipelineService.normalizeSpanReceived(
        event.tenantId,
        event.data.span,
        event.data.resource,
        event.data.instrumentationScope,
      );
    enrichRagContextIds(normalizedSpan);

    return {
      ...applySpanToSummary({ state, span: normalizedSpan }),
      createdAt: state.createdAt,
    };
  }

  handleTraceTopicAssigned(
    event: TopicAssignedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    return {
      ...state,
      topicId: event.data.topicId ?? state.topicId,
      subTopicId: event.data.subtopicId ?? state.subTopicId,
    };
  }

  handleTraceLogRecordReceived(
    event: LogRecordReceivedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    // Standalone OTLP logs (e.g. Claude Code's OTEL_LOGS_EXPORTER without a
    // traces exporter) carry no trace context. The wire-level fix accepts
    // them and the map projection persists them to stored_log_records, but
    // folding them here would aggregate every context-less log per tenant
    // under the same empty aggregateId — surfacing a single nameless
    // "trace" in the messages list that grows unboundedly. Skip the fold;
    // the log row still lands in CH and remains queryable directly.
    if (!event.data.traceId || !event.data.spanId) {
      return state;
    }

    const mergedAttributes = { ...state.attributes };
    const logCount = parseInt(
      mergedAttributes["langwatch.reserved.log_record_count"] ?? "0",
      10,
    );
    mergedAttributes["langwatch.reserved.log_record_count"] = String(
      logCount + 1,
    );

    let computedInput = state.computedInput;
    let computedOutput = state.computedOutput;
    let outputSpanEndTimeMs = state.outputSpanEndTimeMs;
    const currentOutputSource =
      state.attributes["langwatch.reserved.output_source"] ??
      OUTPUT_SOURCE.INFERRED;
    const currentInputIsFallback =
      state.attributes["langwatch.reserved.input_is_fallback"] === "true";
    const currentOutputIsFallback =
      state.attributes["langwatch.reserved.output_is_fallback"] === "true";

    const logIO = extractIOFromLogRecord(event.data);

    if (
      logIO.input !== null &&
      (computedInput === null || currentInputIsFallback)
    ) {
      computedInput = logIO.input;
      delete mergedAttributes["langwatch.reserved.input_is_fallback"];
    }

    if (logIO.output !== null) {
      const shouldOverride =
        currentOutputIsFallback ||
        shouldOverrideOutput({
          isRoot: false,
          outputFromRoot: state.outputFromRootSpan,
          isExplicit: false,
          currentIsExplicit: currentOutputSource === OUTPUT_SOURCE.EXPLICIT,
          endTime: event.data.timeUnixMs,
          currentEndTime: outputSpanEndTimeMs,
        });
      if (shouldOverride) {
        computedOutput = logIO.output;
        outputSpanEndTimeMs = event.data.timeUnixMs;
        mergedAttributes["langwatch.reserved.output_source"] =
          OUTPUT_SOURCE.INFERRED;
        delete mergedAttributes["langwatch.reserved.output_is_fallback"];
      }
    }

    // Lift cost / tokens / model off a claude_code.api_request
    // event onto the canonical langwatch.* attributes so the trace
    // renders the same shape as a real gen_ai span. Stored as
    // strings on attributes (matches how every other lift writes
    // here). The four numeric tokens are intentionally lifted to
    // distinct keys; conflating cache_creation vs cache_read would
    // mis-bill at the trace-summary layer.
    const cc = extractClaudeCodeApiRequestMetrics(event.data);
    if (cc !== null) {
      if (cc.model !== null) {
        mergedAttributes["langwatch.model"] = cc.model;
      }
      if (cc.costUsd !== null) {
        mergedAttributes["langwatch.cost.usd"] = String(cc.costUsd);
      }
      if (cc.inputTokens !== null) {
        mergedAttributes["langwatch.input_tokens"] = String(cc.inputTokens);
      }
      if (cc.outputTokens !== null) {
        mergedAttributes["langwatch.output_tokens"] = String(cc.outputTokens);
      }
      if (cc.cacheReadTokens !== null) {
        mergedAttributes["langwatch.cache_read_tokens"] = String(
          cc.cacheReadTokens,
        );
      }
      if (cc.cacheCreationTokens !== null) {
        mergedAttributes["langwatch.cache_creation_tokens"] = String(
          cc.cacheCreationTokens,
        );
      }
      const sessionId = event.data.attributes["session.id"];
      if (typeof sessionId === "string" && sessionId.length > 0) {
        mergedAttributes["langwatch.thread.id"] = sessionId;
      }
    }

    // Codex equivalent of the claude_code lift: codex.sse_event carries
    // model + token counts + thread.id + principal; codex.conversation_starts
    // carries model + principal at conversation creation. No cost field on
    // the wire — receiver-side model-pricing lookup downstream fills
    // langwatch.cost.usd from (model, tokens). Distinct gating on event.name
    // so claude/gemini events pass through untouched.
    const codexSse = extractCodexSseEventMetrics(event.data);
    if (codexSse !== null) {
      if (codexSse.model !== null) {
        mergedAttributes["langwatch.model"] = codexSse.model;
      }
      if (codexSse.inputTokens !== null) {
        mergedAttributes["langwatch.input_tokens"] = String(
          codexSse.inputTokens,
        );
      }
      if (codexSse.outputTokens !== null) {
        mergedAttributes["langwatch.output_tokens"] = String(
          codexSse.outputTokens,
        );
      }
      if (codexSse.cacheReadTokens !== null) {
        mergedAttributes["langwatch.cache_read_tokens"] = String(
          codexSse.cacheReadTokens,
        );
      }
      if (codexSse.threadId !== null) {
        mergedAttributes["langwatch.thread.id"] = codexSse.threadId;
      }
      if (codexSse.principalEmail !== null) {
        mergedAttributes["langwatch.principal.email"] = codexSse.principalEmail;
      }
    }
    const codexStart = extractCodexConversationStartMetrics(event.data);
    if (codexStart !== null) {
      if (codexStart.model !== null) {
        mergedAttributes["langwatch.model"] = codexStart.model;
      }
      if (codexStart.principalEmail !== null) {
        mergedAttributes["langwatch.principal.email"] =
          codexStart.principalEmail;
      }
    }

    // Defensive belt-and-suspenders mirror of gen_ai.* canonical
    // attributes onto langwatch.*. Gemini CLI 0.32+ emits these on
    // log records (the OTTL ports as GEMINI_OTTL_STARTER); the
    // OpenInferenceExtractor handles the span path but not all log
    // records run through it. Gated on field presence rather than
    // a scope/event-name match so any caller emitting OTel GenAI
    // semconv on logs (custom emitters, future SDKs) benefits.
    const genAi = extractGenAiLogMetrics(event.data);
    if (genAi !== null) {
      if (genAi.model !== null) {
        mergedAttributes["langwatch.model"] = genAi.model;
      }
      if (genAi.inputTokens !== null) {
        mergedAttributes["langwatch.input_tokens"] = String(genAi.inputTokens);
      }
      if (genAi.outputTokens !== null) {
        mergedAttributes["langwatch.output_tokens"] = String(
          genAi.outputTokens,
        );
      }
      if (genAi.cacheReadTokens !== null) {
        mergedAttributes["langwatch.cache_read_tokens"] = String(
          genAi.cacheReadTokens,
        );
      }
      if (genAi.threadId !== null) {
        mergedAttributes["langwatch.thread.id"] = genAi.threadId;
      }
      if (genAi.inputMessages !== null) {
        mergedAttributes["langwatch.input"] = genAi.inputMessages;
      }
      if (genAi.outputMessages !== null) {
        mergedAttributes["langwatch.output"] = genAi.outputMessages;
      }
    }

    return {
      ...state,
      traceId: state.traceId || event.data.traceId,
      computedInput,
      computedOutput,
      outputSpanEndTimeMs,
      attributes: mergedAttributes,
    };
  }

  handleTraceMetricRecordReceived(
    event: MetricRecordReceivedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    // Standalone OTLP metrics (gauges/sums without exemplar trace context)
    // are common from Claude Code's OTEL_METRICS_EXPORTER. The map
    // projection persists them to stored_metric_records; skip the fold to
    // avoid folding every context-less data point into an empty-id ghost
    // summary. Mirrors handleTraceLogRecordReceived.
    if (!event.data.traceId || !event.data.spanId) {
      return state;
    }

    let timeToFirstTokenMs = state.timeToFirstTokenMs;
    if (event.data.metricName === "gen_ai.server.time_to_first_token") {
      const ttftMs = event.data.value * 1000;
      timeToFirstTokenMs =
        timeToFirstTokenMs === null
          ? ttftMs
          : Math.min(timeToFirstTokenMs, ttftMs);
    }

    const mergedAttributes = { ...state.attributes };
    const metricCount = parseInt(
      mergedAttributes["langwatch.reserved.metric_record_count"] ?? "0",
      10,
    );
    mergedAttributes["langwatch.reserved.metric_record_count"] = String(
      metricCount + 1,
    );

    return {
      ...state,
      traceId: state.traceId || event.data.traceId,
      timeToFirstTokenMs,
      attributes: mergedAttributes,
    };
  }

  handleTraceOriginResolved(
    event: OriginResolvedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    const currentOrigin = state.attributes["langwatch.origin"];
    if (currentOrigin) {
      // Explicit origin already set -- do not override
      return state;
    }
    return {
      ...state,
      attributes: {
        ...state.attributes,
        "langwatch.origin": event.data.origin,
      },
    };
  }

  handleTraceAnnotationAdded(
    event: AnnotationAddedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    const ids = state.annotationIds ?? [];
    if (ids.includes(event.data.annotationId)) return state;
    return { ...state, annotationIds: [...ids, event.data.annotationId] };
  }

  handleTraceAnnotationRemoved(
    event: AnnotationRemovedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    const ids = state.annotationIds ?? [];
    return {
      ...state,
      annotationIds: ids.filter(
        (id) => id !== event.data.annotationId,
      ),
    };
  }

  handleTraceAnnotationsBulkSynced(
    event: AnnotationsBulkSyncedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    const merged = [...new Set([...(state.annotationIds ?? []), ...event.data.annotationIds])];
    return { ...state, annotationIds: merged };
  }

  handleTraceTraceNameChanged(
    event: TraceNameChangedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    return {
      ...state,
      traceId: state.traceId || event.data.traceId,
      traceName: event.data.newName,
      // Latch the override so any later root-span arrival doesn't
      // silently revert the user's edit. The latch persists even if
      // the new name happens to coincide with the discovered root span
      // name — intent matters more than the value.
      traceNameUserOverridden: true,
      // A user-supplied name is the highest-precedence source; whatever
      // came before is no longer a "fallback" guess that should be
      // displaced by a later real-root span.
      traceNameFromFallback: false,
    };
  }
}
