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
