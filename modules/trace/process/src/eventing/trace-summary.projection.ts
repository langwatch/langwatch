import {
  type FoldProjectionStore,
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  ATTR_KEYS,
  type AnnotationAddedEvent,
  type AnnotationRemovedEvent,
  type AnnotationsBulkSyncedEvent,
  type LogContributedEvent,
  type LogRecordReceivedEvent,
  type MetricDataPointCorrelatedEvent,
  type NormalizedSpan,
  NON_BILLABLE_ATTR,
  type OriginResolvedEvent,
  type SpanReceivedEvent,
  spanReceivedEventSchema,
  type TopicAssignedEvent,
  type TraceNameChangedEvent,
  type TraceSummaryData,
  SYNTHETIC_TRACE_SPAN_NAMES,
  annotationAddedEventSchema,
  annotationRemovedEventSchema,
  annotationsBulkSyncedEventSchema,
  logContributedEventSchema,
  logRecordReceivedEventSchema,
  metricDataPointCorrelatedEventSchema,
  originResolvedEventSchema,
  topicAssignedEventSchema,
  traceNameChangedEventSchema,
  type TraceCanonicalisationService,
  METRIC_EXEMPLAR_CORRELATION_COUNT_ATTRIBUTE,
  TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
} from "@langwatch/trace-contract";

import { spanStorabilityOf, UNSTORABLE_SPAN_SKIPPED } from "../rules/storable-span-time.rules.ts";
import { anchorStorageTime } from "../rules/trace-storage-anchor.rules.ts";
import type { TraceProjectionRuntimeService } from "../services/projection/trace-projection-runtime.service.ts";
import {
  OUTPUT_SOURCE,
  TraceIOAccumulationService,
} from "../services/trace-io-accumulation.service.ts";
import { TraceLogRecordIOService } from "../services/trace-log-record-io.service.ts";

const logger = createLogger("langwatch:trace-processing:trace-summary-fold");

export type { TraceSummaryData };

// 2026-04-28: trim trailing assistant from chat-shaped input
const COMPUTED_IO_SCHEMA_VERSION = "2026-04-28" as const;

const AI_SPAN_TYPES = new Set(["llm", "agent", "tool", "rag"]);

// ─── Main composition ───────────────────────────────────────────────

/**
 * Max spans fully processed (normalize + derive) into a trace summary. A
 * handful of traces accumulate tens of thousands (reused trace_id, runaway
 * loops); past the cap we only keep counting, to stay visible.
 */
export const MAX_PROCESSED_SPANS = 512;

/**
 * ±7 days, aligned with TRACE_ANALYTICS_READ_WINDOW_MS — see the `options`
 * docstring for the production measurement that retired the ±2-day width.
 */
export const TRACE_SUMMARY_READ_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Reserved keys for cache/reasoning token sums (per-span numbers don't reach
// the attribute allowlist, so we fold sums here instead of adding CH columns)
export const RESERVED_CACHE_READ_TOKENS = "langwatch.reserved.cache_read_tokens";
export const RESERVED_CACHE_CREATION_TOKENS = "langwatch.reserved.cache_creation_tokens";
export const RESERVED_REASONING_TOKENS = "langwatch.reserved.reasoning_tokens";
/**
 * Anthropic's cache-creation split by TTL, summed across the trace's model
 * calls. Rides ONLY api_response_body log events (no span attribute carries
 * it), so summing on the LOG path can never double-count a span-side number.
 */
export const RESERVED_CACHE_CREATION_5M_TOKENS = "langwatch.reserved.cache_creation_5m_tokens";
export const RESERVED_CACHE_CREATION_1H_TOKENS = "langwatch.reserved.cache_creation_1h_tokens";

/**
 * The context the trace's first model call already carried, and the start time
 * of the call that set it (bookkeeping, so a later-arriving earlier span can
 * still win). See {@link recordContextSize}.
 */
export const RESERVED_CONTEXT_SIZE_TOKENS = "langwatch.reserved.context_size_tokens";
export const RESERVED_CONTEXT_SIZE_AT_MS = "langwatch.reserved.context_size_at_ms";

/**
 * A single log record's normalized contribution to the trace summary fold.
 * Both log-path events fold identically once normalized: `log_record_received`
 * builds it from the raw record; `log_contributed` carries lifted fields.
 */
interface LogContribution {
  traceId: string;
  input: string | null;
  output: string | null;
  timeUnixMs: number;
  liftedAttributes: Record<string, unknown>;
  nonBillable: boolean;
}

// ─── Fold projection class ──────────────────────────────────────────

const traceSummaryEvents = [
  spanReceivedEventSchema,
  topicAssignedEventSchema,
  logRecordReceivedEventSchema,
  logContributedEventSchema,
  metricDataPointCorrelatedEventSchema,
  originResolvedEventSchema,
  annotationAddedEventSchema,
  annotationRemovedEventSchema,
  annotationsBulkSyncedEventSchema,
  traceNameChangedEventSchema,
] as const;

// Type-safe fold projection with handlers derived from event type strings
// (e.g. "lw.obs.trace.span_received" -> handleTraceSpanReceived)
export class TraceSummaryFoldProjection
  extends AbstractFoldProjection<
    TraceSummaryData,
    typeof traceSummaryEvents,
    "createdAt",
    "updatedAt",
    "LastEventOccurredAt"
  >
  implements FoldEventHandlers<typeof traceSummaryEvents, TraceSummaryData>
{
  private readonly traceCanonicalisation: TraceCanonicalisationService;
  private readonly logRecordIO: TraceLogRecordIOService;
  private readonly runtime: TraceProjectionRuntimeService;
  readonly name = "traceSummary";
  readonly version = TRACE_SUMMARY_PROJECTION_VERSION_LATEST;
  readonly store: FoldProjectionStore<TraceSummaryData>;

  // Spans fold in arrival order; three fields resolve by fold-order
  // (models, computedInput, computedOutput); readWindow=±7 days; see ADR-087
  // and specs/trace-processing/hot-trace-fold-amplification.feature for details
  readonly options = {
    refoldOnOutOfOrder: false,
    trustAbsentMiss: true,
    readWindow: { widthMs: TRACE_SUMMARY_READ_WINDOW_MS },
  } as const;

  protected readonly events = traceSummaryEvents;

  private constructor(deps: {
    store: FoldProjectionStore<TraceSummaryData>;
    traceCanonicalisation: TraceCanonicalisationService;
    runtime: TraceProjectionRuntimeService;
  }) {
    super({
      createdAtKey: "createdAt",
      updatedAtKey: "updatedAt",
      LastEventOccurredAtKey: "LastEventOccurredAt",
    });
    this.store = deps.store;
    this.traceCanonicalisation = deps.traceCanonicalisation;
    this.logRecordIO = TraceLogRecordIOService.create(deps.traceCanonicalisation);
    this.runtime = deps.runtime;
  }

  static create(deps: {
    store: FoldProjectionStore<TraceSummaryData>;
    traceCanonicalisation: TraceCanonicalisationService;
    runtime: TraceProjectionRuntimeService;
  }): TraceSummaryFoldProjection {
    return new TraceSummaryFoldProjection(deps);
  }

  protected initState(): Omit<TraceSummaryData, "createdAt" | "updatedAt" | "LastEventOccurredAt"> {
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
      nonBilledCost: null,
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
      // storageAnchorMs frozen on first contribution (ADR-087)
      storageAnchorMs: 0,
      // events/costs removed (O(n^2) perf); occurredAt used for first-span detection
      occurredAt: 0,
    };
  }

  // Freeze storage anchor on first contribution (ADR-087); one seam prevents
  // new event types from arriving un-anchored; see anchorStorageTime
  override apply(state: TraceSummaryData, event: { type: string }): TraceSummaryData {
    const folded = super.apply(state, event);
    if (folded === state) return state;
    const eventOccurredAt = (event as { occurredAt?: unknown }).occurredAt;
    return anchorStorageTime({
      state: folded,
      eventOccurredAtMs: typeof eventOccurredAt === "number" ? eventOccurredAt : undefined,
    });
  }

  handleTraceSpanReceived(event: SpanReceivedEvent, state: TraceSummaryData): TraceSummaryData {
    // Past the processing cap, keep counting but skip the expensive
    // normalization + derivation — a runaway trace cannot keep growing the
    // fold cost. Derived fields stay frozen at the first MAX_PROCESSED_SPANS.
    if (state.spanCount >= MAX_PROCESSED_SPANS) {
      return { ...state, spanCount: state.spanCount + 1 };
    }

    // A span whose own times cannot be stored throws inside normalization,
    // permanently; leave the state untouched so the trace's other spans fold.
    const storability = spanStorabilityOf({ event, consumer: "traceSummaryFold" });
    if (!storability.storable) {
      logger.warn(storability.skip, UNSTORABLE_SPAN_SKIPPED);
      return state;
    }

    const normalizedSpan = this.runtime.spanNormalization.normalizeSpanReceived(
      event.tenantId,
      event.data.span,
      event.data.resource,
      event.data.instrumentationScope,
    );
    this.runtime.spanNormalization.enrichRagContextIds(normalizedSpan);

    return {
      ...TraceSummaryFoldProjection.applySpanToSummary({
        state,
        span: normalizedSpan,
        runtime: this.runtime,
      }),
      createdAt: state.createdAt,
    };
  }

  handleTraceTopicAssigned(event: TopicAssignedEvent, state: TraceSummaryData): TraceSummaryData {
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
    // Standalone OTLP logs (e.g. Claude Code without a traces exporter)
    // carry no trace context. Folding them would aggregate every such log
    // per tenant under one empty aggregateId. Skip; the log pipeline stores them.
    if (!event.data.traceId || !event.data.spanId) {
      return state;
    }

    const logIO = this.logRecordIO.extractIO(event.data);

    const liftedAttributes = this.traceCanonicalisation.canonicalizeLogRecord({
      scopeName: event.data.scopeName,
      body: event.data.body,
      attributes: event.data.attributes,
    }).attributes;

    return TraceSummaryFoldProjection.applyLogContribution({
      state,
      runtime: this.runtime,
      contribution: {
        traceId: event.data.traceId,
        input: logIO.input,
        output: logIO.output,
        timeUnixMs: event.data.timeUnixMs,
        liftedAttributes,
        // A log-only emitter has no per-span markers; the receiver stamps the
        // bundled flag on the log record's resource, so classify the whole
        // increment by that.
        nonBillable: event.data.resourceAttributes?.[NON_BILLABLE_ATTR] === "true",
      },
    });
  }

  handleTraceLogContributed(event: LogContributedEvent, state: TraceSummaryData): TraceSummaryData {
    return TraceSummaryFoldProjection.applyLogContribution({
      state,
      runtime: this.runtime,
      contribution: {
        traceId: event.data.traceId,
        input: event.data.input,
        output: event.data.output,
        timeUnixMs: event.data.timeUnixMs,
        liftedAttributes: event.data.liftedAttributes,
        nonBillable: event.data.nonBillable,
      },
    });
  }

  handleTraceMetricDataPointCorrelated(
    event: MetricDataPointCorrelatedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    let timeToFirstTokenMs = state.timeToFirstTokenMs;
    if (
      event.data.metricName === "gen_ai.server.time_to_first_token" &&
      event.data.exemplarValue !== null
    ) {
      const ttftMs = event.data.exemplarValue * 1000;
      timeToFirstTokenMs =
        timeToFirstTokenMs === null ? ttftMs : Math.min(timeToFirstTokenMs, ttftMs);
    }

    // Counts exemplar correlations, not metric data points: the canonical
    // datapoint stream is a separate pipeline this fold never sees, so it
    // cannot know how many points a trace's metrics produced.
    const mergedAttributes = { ...state.attributes };
    const correlationCount = parseInt(
      mergedAttributes[METRIC_EXEMPLAR_CORRELATION_COUNT_ATTRIBUTE] ?? "0",
      10,
    );
    mergedAttributes[METRIC_EXEMPLAR_CORRELATION_COUNT_ATTRIBUTE] = String(correlationCount + 1);

    return {
      ...state,
      traceId: state.traceId || event.data.traceId,
      timeToFirstTokenMs,
      attributes: mergedAttributes,
    };
  }

  handleTraceOriginResolved(event: OriginResolvedEvent, state: TraceSummaryData): TraceSummaryData {
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
      annotationIds: ids.filter((id) => id !== event.data.annotationId),
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

  // Add delta to reserved token counter (public for analytics parity testing)
  static addReservedTokenSum(attributes: Record<string, string>, key: string, delta: number): void {
    if (delta <= 0) return;
    const prior = Number(attributes[key] ?? "0");
    attributes[key] = String((Number.isFinite(prior) ? prior : 0) + delta);
  }

  // Record earliest model call's context window (NOT a sum; agents re-send
  // whole conversation, so context matters more than summed cache reads)
  private static recordContextSize({
    attributes,
    span,
    cacheTokens,
  }: {
    attributes: Record<string, string>;
    span: NormalizedSpan;
    cacheTokens: { cacheReadTokens: number; cacheCreationTokens: number };
  }): void {
    const contextTokens = cacheTokens.cacheReadTokens + cacheTokens.cacheCreationTokens;
    if (contextTokens <= 0) return;
    const priorAtMs = Number(attributes[RESERVED_CONTEXT_SIZE_AT_MS]);
    if (Number.isFinite(priorAtMs) && priorAtMs <= span.startTimeUnixMs) return;
    attributes[RESERVED_CONTEXT_SIZE_TOKENS] = String(contextTokens);
    attributes[RESERVED_CONTEXT_SIZE_AT_MS] = String(span.startTimeUnixMs);
  }

  /** The input and output this turn contributes, and the attribute keys that record them. */
  private static applyLogIO({
    state,
    contribution,
    mergedAttributes,
  }: {
    state: TraceSummaryData;
    contribution: LogContribution;
    mergedAttributes: Record<string, string>;
  }): Pick<TraceSummaryData, "computedInput" | "computedOutput" | "outputSpanEndTimeMs"> {
    let computedInput = state.computedInput;
    let computedOutput = state.computedOutput;
    let outputSpanEndTimeMs = state.outputSpanEndTimeMs;
    const currentOutputSource =
      state.attributes["langwatch.reserved.output_source"] ?? OUTPUT_SOURCE.INFERRED;
    const currentInputIsFallback =
      state.attributes["langwatch.reserved.input_is_fallback"] === "true";
    const currentOutputIsFallback =
      state.attributes["langwatch.reserved.output_is_fallback"] === "true";

    if (contribution.input !== null && (computedInput === null || currentInputIsFallback)) {
      computedInput = contribution.input;
      delete mergedAttributes["langwatch.reserved.input_is_fallback"];
    }

    if (contribution.output !== null) {
      const shouldReplace =
        currentOutputIsFallback ||
        TraceIOAccumulationService.shouldOverrideOutput({
          isRoot: false,
          outputFromRoot: state.outputFromRootSpan,
          isExplicit: false,
          currentIsExplicit: currentOutputSource === OUTPUT_SOURCE.EXPLICIT,
          endTime: contribution.timeUnixMs,
          currentEndTime: outputSpanEndTimeMs,
        });
      if (shouldReplace) {
        computedOutput = contribution.output;
        outputSpanEndTimeMs = contribution.timeUnixMs;
        mergedAttributes["langwatch.reserved.output_source"] = OUTPUT_SOURCE.INFERRED;
        delete mergedAttributes["langwatch.reserved.output_is_fallback"];
      }
    }

    return { computedInput, computedOutput, outputSpanEndTimeMs };
  }

  /**
   * The per-TTL cache-creation lift is PER-CALL and must accumulate, not
   * overwrite: summed into reserved running totals, kept out of the
   * generic last-write-wins merge, and merged after so those keys survive.
   */
  private static mergeLiftedAttributes({
    contribution,
    mergedAttributes,
  }: {
    contribution: LogContribution;
    mergedAttributes: Record<string, string>;
  }): void {
    const perCallSums: [string, string][] = [
      [ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_5M_INPUT_TOKENS, RESERVED_CACHE_CREATION_5M_TOKENS],
      [ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_1H_INPUT_TOKENS, RESERVED_CACHE_CREATION_1H_TOKENS],
    ];
    for (const [source, reservedKey] of perCallSums) {
      const value = Number(contribution.liftedAttributes[source]);
      if (Number.isFinite(value)) {
        TraceSummaryFoldProjection.addReservedTokenSum(mergedAttributes, reservedKey, value);
      }
    }

    const perCallKeys = new Set(perCallSums.map(([source]) => source));
    for (const [key, value] of Object.entries(contribution.liftedAttributes)) {
      if (perCallKeys.has(key)) {
        continue;
      }

      mergedAttributes[key] = String(value);
    }
  }

  /** The models, cost and token totals this turn adds to the running trace summary. */
  private static applyLogTotals({
    state,
    contribution,
  }: {
    state: TraceSummaryData;
    contribution: LogContribution;
  }): Pick<
    TraceSummaryData,
    "models" | "totalCost" | "nonBilledCost" | "totalPromptTokenCount" | "totalCompletionTokenCount"
  > {
    let models = state.models;
    let totalCost = state.totalCost;
    let nonBilledCost = state.nonBilledCost;
    let totalPromptTokenCount = state.totalPromptTokenCount;
    let totalCompletionTokenCount = state.totalCompletionTokenCount;

    const model = contribution.liftedAttributes["langwatch.model"];
    if (typeof model === "string" && model.length > 0) {
      models = TraceSummaryFoldProjection.mergeModelsMostRecentFirst(models, [model]);
    }

    const cost = Number(contribution.liftedAttributes["langwatch.cost.usd"]);
    if (Number.isFinite(cost) && cost > 0) {
      totalCost = (totalCost ?? 0) + cost;
      if (contribution.nonBillable) {
        nonBilledCost = (nonBilledCost ?? 0) + cost;
      }
    }

    const inputTokens = Number(contribution.liftedAttributes["langwatch.input_tokens"]);
    if (Number.isFinite(inputTokens) && inputTokens > 0) {
      totalPromptTokenCount = (totalPromptTokenCount ?? 0) + inputTokens;
    }

    const outputTokens = Number(contribution.liftedAttributes["langwatch.output_tokens"]);
    if (Number.isFinite(outputTokens) && outputTokens > 0) {
      totalCompletionTokenCount = (totalCompletionTokenCount ?? 0) + outputTokens;
    }

    return {
      models,
      totalCost,
      nonBilledCost,
      totalPromptTokenCount,
      totalCompletionTokenCount,
    };
  }

  // Fold log contribution: bump count, apply I/O semantics, merge attributes,
  // mirror to top-level columns. Read from liftedAttributes to avoid double-count
  private static applyLogContribution({
    state,
    contribution,
    runtime,
  }: {
    state: TraceSummaryData;
    contribution: LogContribution;
    runtime: TraceProjectionRuntimeService;
  }): TraceSummaryData {
    const mergedAttributes = { ...state.attributes };
    const logCount = parseInt(mergedAttributes["langwatch.reserved.log_record_count"] ?? "0", 10);
    mergedAttributes["langwatch.reserved.log_record_count"] = String(logCount + 1);

    const io = TraceSummaryFoldProjection.applyLogIO({ state, contribution, mergedAttributes });
    TraceSummaryFoldProjection.mergeLiftedAttributes({ contribution, mergedAttributes });
    const totals = TraceSummaryFoldProjection.applyLogTotals({ state, contribution });

    // Same trace-level model metadata stamp the span path applies, so
    // log-only (Path B) traces also surface `metadata.model`.
    runtime.traceAttributes.stampModelMetadata({
      attributes: mergedAttributes,
      models: totals.models,
    });

    return {
      ...state,
      traceId: state.traceId || contribution.traceId,
      ...io,
      attributes: mergedAttributes,
      ...totals,
    };
  }

  // Merge models most-recently-used first (models[0] = primary model the trace used)
  static mergeModelsMostRecentFirst(existing: string[], incoming: string[]): string[] {
    const fresh = [...new Set(incoming)].filter((m) => m.length > 0);
    if (fresh.length === 0) return existing;
    const rest = existing.filter((m) => !fresh.includes(m));
    return [...fresh, ...rest];
  }

  /** @internal Exported for unit testing */
  static applySpanToSummary({
    state,
    span,
    runtime,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
    runtime: TraceProjectionRuntimeService;
  }): TraceSummaryData {
    if (SYNTHETIC_TRACE_SPAN_NAMES.has(span.name)) {
      // Synthetic spans (e.g. `langwatch.track_event`) must not contribute to
      // timing/cost/I-O -- they don't represent real execution. Their payload
      // (the `/api/track_event` endpoint stuffs the user-tracked event into
      // `span.events`) is still persisted to stored_spans like any other span,
      // so the trace-level events list is derived from there at read time.
      return state;
    }

    const timing = runtime.spanTiming.accumulateTiming({ state, span });
    const tokens = runtime.spanCost.accumulateTokens({
      state,
      span,
      totalDurationMs: timing.totalDurationMs,
    });
    const status = runtime.spanStatus.accumulateStatus({ state, span });
    const io = runtime.traceIo.accumulateIO({ state, span });
    const attributes = runtime.traceAttributes.accumulateAttributes({
      state,
      span,
      outputSource: io.outputSource,
      inputIsFallback: io.inputIsFallback,
      outputIsFallback: io.outputIsFallback,
      inputMediaRefs: io.inputMediaRefs,
      outputMediaRefs: io.outputMediaRefs,
    });

    // Roll the per-span cache / reasoning token counts into trace-level sums.
    // The merged attribute map only carries identity/metadata keys, so the
    // raw gen_ai.usage.cache_* numbers never reach the drawer — fold the sums
    // in under reserved keys the popover reads directly.
    const cacheTokens = runtime.spanCost.isTokenAccumulationSkipped(span)
      ? { cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0 }
      : runtime.spanCost.extractCacheTokens(span);
    TraceSummaryFoldProjection.addReservedTokenSum(
      attributes,
      RESERVED_CACHE_READ_TOKENS,
      cacheTokens.cacheReadTokens,
    );
    TraceSummaryFoldProjection.addReservedTokenSum(
      attributes,
      RESERVED_CACHE_CREATION_TOKENS,
      cacheTokens.cacheCreationTokens,
    );
    TraceSummaryFoldProjection.addReservedTokenSum(
      attributes,
      RESERVED_REASONING_TOKENS,
      cacheTokens.reasoningTokens,
    );
    TraceSummaryFoldProjection.recordContextSize({ attributes, span, cacheTokens });

    const newModels = runtime.spanCost.extractModelsFromSpan(span);
    const models = TraceSummaryFoldProjection.mergeModelsMostRecentFirst(state.models, newModels);

    // Surface the span-derived models as trace-level metadata (primary +
    // set) so `trace.metadata.model` is populated for API consumers and
    // metadata filters, not just the Models column.
    runtime.traceAttributes.stampModelMetadata({ attributes, models });

    // Precedence rules for traceName / rootSpanType / rootSpanStartTimeMs
    // live in TraceNameResolutionService — see that file for the full set.
    const {
      traceName,
      rootSpanType,
      rootSpanStartTimeMs,
      traceNameFromFallback,
      rootMetadataFromFallback,
    } = runtime.traceName.resolveFromSpan({ state, span });

    const rawSpanType = span.spanAttributes[ATTR_KEYS.SPAN_TYPE];
    const spanType = typeof rawSpanType === "string" ? rawSpanType : "";
    const containsAi = state.containsAi || AI_SPAN_TYPES.has(spanType);

    const promptRollup = runtime.tracePrompt.accumulate({
      state,
      span,
    });

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
}
