import { detectCodingAgentHarness } from "~/server/app-layer/traces/block-classification/harnessDetection";
import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import { appendSessionStep } from "~/server/app-layer/traces/session-rollup/sessionSteps";
import {
  enrichRagContextIds,
  SpanNormalizationPipelineService,
} from "~/server/app-layer/traces/span-normalization.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "~/server/event-sourcing/projections/abstractFoldProjection";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import { SYNTHETIC_SPAN_NAMES } from "~/server/tracer/constants";
import { TRACE_SUMMARY_PROJECTION_VERSION_LATEST } from "../schemas/constants";
import type {
  AnnotationAddedEvent,
  AnnotationRemovedEvent,
  AnnotationsBulkSyncedEvent,
  LogRecordReceivedEvent,
  MetricRecordReceivedEvent,
  OriginResolvedEvent,
  SpanReceivedEvent,
  TopicAssignedEvent,
  TraceNameChangedEvent,
} from "../schemas/events";
import {
  annotationAddedEventSchema,
  annotationRemovedEventSchema,
  annotationsBulkSyncedEventSchema,
  logRecordReceivedEventSchema,
  metricRecordReceivedEventSchema,
  originResolvedEventSchema,
  spanReceivedEventSchema,
  topicAssignedEventSchema,
  traceNameChangedEventSchema,
} from "../schemas/events";
import type { NormalizedSpan } from "../schemas/spans";
import {
  extractIOFromLogRecord,
  liftCanonicalAttributesFromLogRecord,
  NON_BILLABLE_ATTR,
  OUTPUT_SOURCE,
  SpanCostService,
  SpanStatusService,
  SpanTimingService,
  shouldOverrideOutput,
  TraceAttributeAccumulationService,
  TraceIOAccumulationService,
  TraceNameResolutionService,
  TraceOriginService,
  TracePromptAccumulationService,
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
const traceAttributeAccumulationService = new TraceAttributeAccumulationService(
  traceOriginService,
);
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

/**
 * Reserved trace-summary attribute keys holding cache / reasoning token
 * SUMS across the whole trace. The per-span `gen_ai.usage.cache_*` numbers
 * never reach the trace-level attribute map (the accumulation allowlist
 * only carries identity/metadata keys), so the drawer popover had nothing
 * to read and "Cache write" stayed permanently hidden. We fold the sums in
 * here under reserved keys — same transport the log/output bookkeeping
 * already uses — instead of adding three CH columns for what is display
 * detail. The drawer reads these first and falls back to the raw per-span
 * key for traces folded before this landed.
 */
export const RESERVED_CACHE_READ_TOKENS =
  "langwatch.reserved.cache_read_tokens";
export const RESERVED_CACHE_CREATION_TOKENS =
  "langwatch.reserved.cache_creation_tokens";
export const RESERVED_REASONING_TOKENS = "langwatch.reserved.reasoning_tokens";

/**
 * Merge the models seen on one span (or log turn) into the running list,
 * most-recently-used FIRST. `models[0]` is therefore always the last model
 * the trace actually used — the conversational/primary model — rather than
 * an alphabetical pick (which surfaced the title-generation haiku call over
 * the opus turn it belonged to) or the first-touched model. Every consumer
 * that reads `models[0]` as "the model" gets the right one, and the surplus
 * spills into the "+N" badge in encounter-recency order.
 */
export function mergeModelsMostRecentFirst(
  existing: string[],
  incoming: string[],
): string[] {
  const fresh = [...new Set(incoming)].filter((m) => m.length > 0);
  if (fresh.length === 0) return existing;
  const rest = existing.filter((m) => !fresh.includes(m));
  return [...fresh, ...rest];
}

/**
 * Codex lifts the principal email onto this canonical key from its
 * `codex.sse_event` / `codex.conversation_starts` log records (see the codex
 * extractor). No other log extractor emits it, so it is the positive
 * codex-specific marker the fallback below keys on.
 */
const CODEX_PRINCIPAL_EMAIL_ATTR = "langwatch.principal.email";

/**
 * Harness for a Path B log turn (ADR-033 session tracking). Reads the canonical
 * scope first; falls back to `codex` only when the record carries a thread id,
 * input usage, AND the codex-specific principal-email lift. Codex does not pin
 * its log scope name across releases, so the scope check alone misses its
 * usage-bearing `sse_event` logs — but the fallback must stay codex-specific:
 * the generic gen_ai log extractor lifts a thread id + input usage for any
 * OTel-genai emitter (gemini CLI, custom emitters), so keying the fallback on
 * thread-id-plus-usage alone would sweep that traffic into session tracking.
 * Requiring the codex-only principal-email lift keeps it scoped to codex.
 */
function detectLogTurnHarness({
  scopeName,
  liftedAttrs,
  liftedThreadId,
  liftedInputTokens,
}: {
  scopeName: string;
  liftedAttrs: Record<string, unknown>;
  liftedThreadId: string | undefined;
  liftedInputTokens: number;
}): "claude" | "codex" | null {
  const detected = detectCodingAgentHarness({
    instrumentationScopeName: scopeName,
    spanAttributes: liftedAttrs,
  });
  if (detected) return detected;
  const hasCodexPrincipal =
    typeof liftedAttrs[CODEX_PRINCIPAL_EMAIL_ATTR] === "string" &&
    (liftedAttrs[CODEX_PRINCIPAL_EMAIL_ATTR] as string).length > 0;
  if (liftedThreadId && liftedInputTokens > 0 && hasCodexPrincipal)
    return "codex";
  return null;
}

/** Add a positive per-span delta onto a reserved running-sum attribute. */
function addReservedTokenSum(
  attributes: Record<string, string>,
  key: string,
  delta: number,
): void {
  if (delta <= 0) return;
  const prior = Number(attributes[key] ?? "0");
  const sum = (Number.isFinite(prior) ? prior : 0) + delta;
  // Cost sums keep 10 decimals; re-round each accumulation so binary-float noise
  // (0.0004780000000000037 after 400 spans) doesn't accrete over a long trace.
  // Token sums are integral, so they need no rounding.
  attributes[key] = key.endsWith(".cost_usd")
    ? String(Number(sum.toFixed(10)))
    : String(sum);
}

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

  // Roll the per-span cache / reasoning token counts into trace-level sums.
  // The merged attribute map only carries identity/metadata keys, so the
  // raw gen_ai.usage.cache_* numbers never reach the drawer — fold the sums
  // in under reserved keys the popover reads directly.
  const cacheTokens = spanCostService.isTokenAccumulationSkipped(span)
    ? { cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0 }
    : spanCostService.extractCacheTokens(span);
  addReservedTokenSum(
    attributes,
    RESERVED_CACHE_READ_TOKENS,
    cacheTokens.cacheReadTokens,
  );
  addReservedTokenSum(
    attributes,
    RESERVED_CACHE_CREATION_TOKENS,
    cacheTokens.cacheCreationTokens,
  );
  addReservedTokenSum(
    attributes,
    RESERVED_REASONING_TOKENS,
    cacheTokens.reasoningTokens,
  );

  // ADR-033: roll each span's per-category block totals into trace-level running
  // sums under the same reserved keys. A span whose tokens are excluded from
  // accumulation (codex's redundant usage copy) must also skip its blockcat
  // totals, or the trace would double-count the categories for that turn.
  const blockCategoryDeltas = spanCostService.isTokenAccumulationSkipped(span)
    ? {}
    : spanCostService.extractBlockCategoryDeltas(span);
  for (const [key, delta] of Object.entries(blockCategoryDeltas)) {
    addReservedTokenSum(attributes, key, delta);
  }

  // ADR-033 session tracking: append this step's context size to the trace's
  // step series when the span is a coding-agent LLM step with positive input
  // usage. The read-time session rollup groups these by thread id to
  // reconstruct context growth and detect compaction. Two exclusions keep a
  // step counted exactly once and free of phantom measurements:
  //   - a span whose tokens are excluded from accumulation (codex's redundant
  //     usage copy) is skipped so a turn is not double-counted;
  //   - a zero-input span is skipped — it carries no context measurement, and
  //     a 0 always reads as a compaction candidate downstream (a classified
  //     span can have block totals yet zero input tokens).
  if (!spanCostService.isTokenAccumulationSkipped(span)) {
    const harness = detectCodingAgentHarness({
      instrumentationScopeName: span.instrumentationScope?.name ?? null,
      spanAttributes: span.spanAttributes,
    });
    // Only coding-agent spans feed the session series, so resolve the harness
    // first and skip the token sum entirely for everything else. Reuse the
    // cache tokens already extracted above rather than re-scanning the span.
    const stepInputTokens = harness
      ? spanCostService.extractStepInputTokens(span, harness, cacheTokens)
      : 0;
    if (harness && stepInputTokens > 0) {
      appendSessionStep({
        attributes,
        harness,
        startMs: span.startTimeUnixMs,
        inputTokens: stepInputTokens,
      });
    }
  }

  const newModels = spanCostService.extractModelsFromSpan(span);
  const models = mergeModelsMostRecentFirst(state.models, newModels);

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

  const promptRollup = tracePromptAccumulationService.accumulate({
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
  extends AbstractFoldProjection<
    TraceSummaryData,
    typeof traceSummaryEvents,
    "createdAt",
    "updatedAt",
    "LastEventOccurredAt"
  >
  implements FoldEventHandlers<typeof traceSummaryEvents, TraceSummaryData>
{
  readonly name = "traceSummary";
  readonly version = TRACE_SUMMARY_PROJECTION_VERSION_LATEST;
  readonly store: FoldProjectionStore<TraceSummaryData>;

  protected readonly events = traceSummaryEvents;

  constructor(deps: { store: FoldProjectionStore<TraceSummaryData> }) {
    super({
      createdAtKey: "createdAt",
      updatedAtKey: "updatedAt",
      LastEventOccurredAtKey: "LastEventOccurredAt",
    });
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

    // Run the canonical extractor registry against this log record.
    // Each extractor (ClaudeCode, Codex, GenAI, SpringAI) claims its
    // own scope/event-name surface and lifts model / cost / tokens /
    // cache / thread.id onto canonical langwatch.* keys. Adding a new
    // platform tool is a one-line addition to the registry plus a new
    // extractor class under canonicalisation/extractors/. The lifts
    // are merged into mergedAttributes here so reserved + log_count
    // keys set above remain intact.
    const liftedAttrs = liftCanonicalAttributesFromLogRecord(event.data);
    for (const [key, value] of Object.entries(liftedAttrs)) {
      mergedAttributes[key] = value as string;
    }

    // Mirror the canonical langwatch.* attrs lifted from this log
    // record onto the top-level TraceSummary columns the v2 drawer +
    // /traces list read directly (Models / TotalCost /
    // TotalPromptTokenCount / TotalCompletionTokenCount). Without this
    // mirror a Path B log-only trace ends up with the right strings on
    // state.attributes but trace.totalCost still NULL, so the drawer
    // chip and the cost column on /traces both render empty even
    // though the data is sitting in CH.
    //
    // Each api_request event is its OWN turn. Cost + tokens are
    // additive across turns; models are a deduped set. Reading from
    // liftedAttrs (this event's contribution) rather than
    // mergedAttributes (the cumulative latest snapshot) is critical
    // for cost so we don't double-count across replays.
    let models = state.models;
    let totalCost = state.totalCost;
    let nonBilledCost = state.nonBilledCost;
    let totalPromptTokenCount = state.totalPromptTokenCount;
    let totalCompletionTokenCount = state.totalCompletionTokenCount;
    const liftedModel = liftedAttrs["langwatch.model"];
    if (typeof liftedModel === "string" && liftedModel.length > 0) {
      models = mergeModelsMostRecentFirst(models, [liftedModel]);
    }
    const liftedCost = Number(liftedAttrs["langwatch.cost.usd"]);
    if (Number.isFinite(liftedCost) && liftedCost > 0) {
      totalCost = (totalCost ?? 0) + liftedCost;
      // A log-only emitter has no per-span markers; the receiver stamps the
      // bundled flag on the log record's resource, so classify the whole
      // increment by that.
      const resAttr = event.data.resourceAttributes?.[NON_BILLABLE_ATTR];
      if (resAttr === "true") {
        nonBilledCost = (nonBilledCost ?? 0) + liftedCost;
      }
    }
    const liftedIn = Number(liftedAttrs["langwatch.input_tokens"]);
    if (Number.isFinite(liftedIn) && liftedIn > 0) {
      totalPromptTokenCount = (totalPromptTokenCount ?? 0) + liftedIn;
    }
    const liftedOut = Number(liftedAttrs["langwatch.output_tokens"]);
    if (Number.isFinite(liftedOut) && liftedOut > 0) {
      totalCompletionTokenCount = (totalCompletionTokenCount ?? 0) + liftedOut;
    }

    // ADR-033 session tracking: a Path B log turn that carries a coding-agent
    // thread id and input usage is one session step. Codex fragments a session
    // across traces, so its step series lives on each trace summary and the
    // read-time rollup re-joins them by thread id. Step context size sums the
    // whole prompt context (fresh + cache-read + cache-creation), mirroring
    // the span path's extractStepInputTokens. No extractor lifts
    // langwatch.cache_creation_tokens today, so that term is 0 on this path —
    // it is included so the two paths stay definitionally identical if an
    // extractor ever starts lifting it.
    const liftedThreadId =
      typeof liftedAttrs["langwatch.thread.id"] === "string"
        ? (liftedAttrs["langwatch.thread.id"] as string)
        : undefined;
    const positive = (value: number): number =>
      Number.isFinite(value) && value > 0 ? value : 0;
    const stepInputTokens =
      positive(liftedIn) +
      positive(Number(liftedAttrs["langwatch.cache_read_tokens"])) +
      positive(Number(liftedAttrs["langwatch.cache_creation_tokens"]));
    const logHarness = detectLogTurnHarness({
      scopeName: event.data.scopeName,
      liftedAttrs,
      liftedThreadId,
      liftedInputTokens: stepInputTokens,
    });
    if (logHarness && stepInputTokens > 0) {
      appendSessionStep({
        attributes: mergedAttributes,
        harness: logHarness,
        startMs: event.data.timeUnixMs,
        inputTokens: stepInputTokens,
      });
    }

    return {
      ...state,
      traceId: state.traceId || event.data.traceId,
      computedInput,
      computedOutput,
      outputSpanEndTimeMs,
      attributes: mergedAttributes,
      models,
      totalCost,
      nonBilledCost,
      totalPromptTokenCount,
      totalCompletionTokenCount,
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
      annotationIds: ids.filter((id) => id !== event.data.annotationId),
    };
  }

  handleTraceAnnotationsBulkSynced(
    event: AnnotationsBulkSyncedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    const merged = [
      ...new Set([...(state.annotationIds ?? []), ...event.data.annotationIds]),
    ];
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
