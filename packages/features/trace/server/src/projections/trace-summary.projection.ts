import type { FoldProjectionStore } from "@langwatch/eventing";
import { AbstractFoldProjection, type FoldEventHandlers } from "@langwatch/eventing";
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
} from "@langwatch/trace-contract";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import {
  METRIC_EXEMPLAR_CORRELATION_COUNT_ATTRIBUTE,
  TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
} from "@langwatch/trace-contract";
import {
  extractIOFromLogRecord,
  OUTPUT_SOURCE,
  shouldOverrideOutput,
} from "../services/trace-io-accumulation.service";
import { TraceProjectionRuntimeService } from "../services/trace-projection-runtime.service";
import { anchorStorageTime } from "../services/trace-storage-anchor.rules";

export type { TraceSummaryData };

// 2026-04-28: trim trailing assistant from chat-shaped input
const COMPUTED_IO_SCHEMA_VERSION = "2026-04-28" as const;

const AI_SPAN_TYPES = new Set(["llm", "agent", "tool", "rag"]);

// ─── Main composition ───────────────────────────────────────────────

/**
 * Max spans we fully process (normalize + derive) into a trace summary. A
 * handful of traces accumulate tens of thousands of spans (reused trace_id,
 * runaway loops); deriving every one pays unbounded cost for no added value.
 * Past the cap we only keep counting so the true magnitude stays visible.
 */
export const MAX_PROCESSED_SPANS = 512;

/**
 * ±7 days, aligned with TRACE_ANALYTICS_READ_WINDOW_MS — see the `options`
 * docstring for the production measurement that retired the ±2-day width.
 */
export const TRACE_SUMMARY_READ_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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
export const RESERVED_CACHE_READ_TOKENS = "langwatch.reserved.cache_read_tokens";
export const RESERVED_CACHE_CREATION_TOKENS = "langwatch.reserved.cache_creation_tokens";
export const RESERVED_REASONING_TOKENS = "langwatch.reserved.reasoning_tokens";
/**
 * Anthropic's cache-creation split by TTL, summed across the trace's model
 * calls. The split rides ONLY the api_response_body log events (no span
 * attribute carries it), so unlike the read/creation totals above these sums
 * accumulate on the LOG contribution path, which also means summing them
 * there can never double-count a span-side number.
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
 * Merge the models seen on one span (or log turn) into the running list,
 * most-recently-used FIRST. `models[0]` is therefore always the last model
 * the trace actually used — the conversational/primary model — rather than
 * an alphabetical pick (which surfaced the title-generation haiku call over
 * the opus turn it belonged to) or the first-touched model. Every consumer
 * that reads `models[0]` as "the model" gets the right one, and the surplus
 * spills into the "+N" badge in encounter-recency order.
 */
export function mergeModelsMostRecentFirst(existing: string[], incoming: string[]): string[] {
  const fresh = [...new Set(incoming)].filter((m) => m.length > 0);
  if (fresh.length === 0) return existing;
  const rest = existing.filter((m) => !fresh.includes(m));
  return [...fresh, ...rest];
}

/** Add a positive per-span delta onto a reserved running-sum attribute. */
function addReservedTokenSum(attributes: Record<string, string>, key: string, delta: number): void {
  if (delta <= 0) return;
  const prior = Number(attributes[key] ?? "0");
  attributes[key] = String((Number.isFinite(prior) ? prior : 0) + delta);
}

/**
 * How full the context window already was when this trace started working:
 * the cached-plus-freshly-written input of its EARLIEST model call. Unlike
 * every other token number on a trace this is deliberately NOT a sum, and the
 * difference matters: a coding-agent turn re-sends its whole conversation on
 * every call, so summed cache reads run to millions while the thing a reader
 * actually wants ("how much was I already carrying") is a single call's worth.
 *
 * Earliest by span start time rather than fold order: spans arrive in whatever
 * order their exporter batched them.
 */
function recordContextSize({
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

/** @internal Exported for unit testing */
export function applySpanToSummary({
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
  addReservedTokenSum(attributes, RESERVED_CACHE_READ_TOKENS, cacheTokens.cacheReadTokens);
  addReservedTokenSum(attributes, RESERVED_CACHE_CREATION_TOKENS, cacheTokens.cacheCreationTokens);
  addReservedTokenSum(attributes, RESERVED_REASONING_TOKENS, cacheTokens.reasoningTokens);
  recordContextSize({ attributes, span, cacheTokens });

  const newModels = runtime.spanCost.extractModelsFromSpan(span);
  const models = mergeModelsMostRecentFirst(state.models, newModels);

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

  const spanType = String(span.spanAttributes[ATTR_KEYS.SPAN_TYPE] ?? "");
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

/**
 * A single log record's normalized contribution to the trace summary fold.
 * Both log-path events fold identically once normalized to this shape:
 * `log_record_received` builds it from the raw record (IO extraction +
 * canonical lift + resource-level non-billable flag), `log_contributed`
 * carries the already-lifted fields on the event itself.
 */
interface LogContribution {
  traceId: string;
  input: string | null;
  output: string | null;
  timeUnixMs: number;
  liftedAttributes: Record<string, unknown>;
  nonBillable: boolean;
}

/**
 * Fold one log contribution into the summary: bump the reserved log
 * count, apply the input/output override semantics, merge the lifted
 * canonical langwatch.* attributes, and mirror them onto the top-level
 * TraceSummary columns the v2 drawer + /traces list read directly
 * (Models / TotalCost / TotalPromptTokenCount /
 * TotalCompletionTokenCount). Without this mirror a Path B log-only
 * trace ends up with the right strings on state.attributes but
 * trace.totalCost still NULL, so the drawer chip and the cost column
 * on /traces both render empty even though the data is sitting in CH.
 *
 * Each api_request event is its OWN turn. Cost + tokens are additive
 * across turns; models are a deduped set. Reading from
 * contribution.liftedAttributes (this event's contribution) rather
 * than mergedAttributes (the cumulative latest snapshot) is critical
 * for cost so we don't double-count across replays.
 */
function applyLogContribution({
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
      shouldOverrideOutput({
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

  // The per-TTL cache-creation lift is a PER-CALL value that must accumulate,
  // not overwrite: sum it into the reserved running totals and keep the
  // per-call keys out of the generic last-write-wins merge below.
  const cacheCreation5m = Number(
    contribution.liftedAttributes[ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_5M_INPUT_TOKENS],
  );
  if (Number.isFinite(cacheCreation5m)) {
    addReservedTokenSum(mergedAttributes, RESERVED_CACHE_CREATION_5M_TOKENS, cacheCreation5m);
  }
  const cacheCreation1h = Number(
    contribution.liftedAttributes[ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_1H_INPUT_TOKENS],
  );
  if (Number.isFinite(cacheCreation1h)) {
    addReservedTokenSum(mergedAttributes, RESERVED_CACHE_CREATION_1H_TOKENS, cacheCreation1h);
  }

  // The lifts are merged into mergedAttributes here so the reserved +
  // log_count keys set above remain intact.
  for (const [key, value] of Object.entries(contribution.liftedAttributes)) {
    if (
      key === ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_5M_INPUT_TOKENS ||
      key === ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_1H_INPUT_TOKENS
    ) {
      continue;
    }
    mergedAttributes[key] = String(value);
  }

  let models = state.models;
  let totalCost = state.totalCost;
  let nonBilledCost = state.nonBilledCost;
  let totalPromptTokenCount = state.totalPromptTokenCount;
  let totalCompletionTokenCount = state.totalCompletionTokenCount;
  const model = contribution.liftedAttributes["langwatch.model"];
  if (typeof model === "string" && model.length > 0) {
    models = mergeModelsMostRecentFirst(models, [model]);
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

  // Same trace-level model metadata stamp the span path applies, so
  // log-only (Path B) traces also surface `metadata.model`.
  runtime.traceAttributes.stampModelMetadata({
    attributes: mergedAttributes,
    models,
  });

  return {
    ...state,
    traceId: state.traceId || contribution.traceId,
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
  private readonly traceCanonicalisation: TraceCanonicalisationService;
  private readonly runtime: TraceProjectionRuntimeService;
  readonly name = "traceSummary";
  readonly version = TRACE_SUMMARY_PROJECTION_VERSION_LATEST;
  readonly store: FoldProjectionStore<TraceSummaryData>;

  /**
   * A span is folded whenever it arrives; an out-of-order span never replays the
   * trace's history. Nearly every field is order-free: spanCount and the
   * token/cost totals are sums, timing is min/max, status is an OR, the semantic
   * output override compares span end times (`shouldOverrideOutput`), and trace
   * naming compares root-span start times.
   *
   * Three fields ARE resolved in fold order, and we accept that:
   *   - `models` — `mergeModelsMostRecentFirst` puts the last-folded model first,
   *     so `models[0]` is the trace's primary model.
   *   - `computedInput` — among several parentless "root" spans the last-folded
   *     one wins; among non-root spans the first-folded one wins
   *     (`trace-io-accumulation.service.ts`, the `isRoot || computedInput === null`
   *     branch). There is no timestamp tiebreak.
   *   - `computedOutput` when only a *fallback* (non-semantic) extraction exists —
   *     the first-folded fallback wins. A later semantic match still overrides it.
   *
   * This costs less than it reads. `occurredAt` on a span event is the INGEST
   * wall-clock (`trace-request-collection.service.ts` stamps `Date.now()`), not
   * the span's own start time — so the replay never restored span-time order
   * either, only global ingest order. `executeBatch` folds each batch in
   * occurredAt order, so within a batch nothing changes; across batches these
   * three fields may resolve differently than a full replay would, on
   * multi-root traces. That is a display-level difference in fields whose
   * selection was already ingest-order dependent, not a lost invariant.
   *
   * Leaving the replay on was ruinous once recordSpan sharded across GroupQueue
   * lanes, because a hot trace's spans then arrive out of order constantly: one
   * trace re-folded 730 times in two hours, re-reading 5.66M event rows, and
   * never caught up (2026-07-09 —
   * specs/trace-processing/hot-trace-fold-amplification.feature).
   */
  /**
   * `readWindow` bounds the read-back to a partition-pruned window around the
   * folded event's business time. ±7 days, matching the other analytics folds
   * — NOT the platform's shared ±2-day partition window this fold used to
   * declare. That width's rationale ("drift from the folded event's occurredAt
   * is clock skew, not aggregate lifetime") measured FALSE in production:
   * 138,654 unwindowed fallback recoveries in 30 days, i.e. ~4.6k times a DAY
   * a live summary row sat 2-7 days from the incoming event — evaluations and
   * annotations land on traces days after their anchor, and a span event's
   * occurredAt is INGEST wall-clock besides. Beyond 7 days the drift measures
   * zero: the 7-day-windowed folds' fallback `recovered` count over the same
   * 30 days is 0 across 230k+ misses.
   *
   * `trustAbsentMiss: true` — an absent windowed read is final; no unwindowed
   * retry. This fold's stake in that retry is narrower than the read-back
   * folds': it declares no `refoldOnStoreMiss`, so an absent miss always
   * folded from `init()` — the retry only decided whether a row EXISTED
   * outside the window. At ±7 days that is measured-never (above), and the
   * one state the retry could not have found anyway is one the store's own
   * persistability gate never wrote — a dimension-only summary, which lives
   * in the Redis tier alone today, trusted or not. So the retry was proving
   * non-existence at ~100 unpruned scans/min; the flag stops paying for the
   * proof. Watch `es_fold_read_window_fallback_total{outcome="recovered"}`
   * on the OTHER folds for the width contract, as ever.
   */
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
    this.runtime = deps.runtime;
  }

  static create(deps: {
    store: FoldProjectionStore<TraceSummaryData>;
    traceCanonicalisation: TraceCanonicalisationService;
    runtime: TraceProjectionRuntimeService;
  }): TraceSummaryFoldProjection {
    return new TraceSummaryFoldProjection(deps);
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
      // Sentinel: 0 means "nothing observed yet". `apply` freezes it on the
      // first contribution carrying a usable business time, and it is what the
      // repository writes into the `OccurredAt` partition/TTL column (ADR-087).
      storageAnchorMs: 0,
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

  /**
   * Dispatch as the base class does, then freeze the storage anchor if this is
   * the first contribution that carried a usable business time (ADR-087,
   * {@link anchorStorageTime}).
   *
   * Here rather than in the ten handlers because the anchor's rule is about
   * CONTRIBUTIONS, not about spans: a trace whose only signal is a log record, a
   * metric correlation or a topic assignment must still get a real partition and
   * a real TTL deadline. One seam also means a new event type cannot silently
   * arrive un-anchored — the way `state.occurredAt` left every non-span
   * contribution anchored at the epoch.
   *
   * After `super.apply`, so a span's own start time (which the handler has by
   * then put on `state.occurredAt`) is preferred over the envelope's ingest
   * stamp, and so an unhandled event type — which `super.apply` returns
   * untouched — anchors nothing.
   */
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

    const normalizedSpan = this.runtime.spanNormalization.normalizeSpanReceived(
      event.tenantId,
      event.data.span,
      event.data.resource,
      event.data.instrumentationScope,
    );
    this.runtime.spanNormalization.enrichRagContextIds(normalizedSpan);

    return {
      ...applySpanToSummary({
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
    // Standalone OTLP logs (e.g. Claude Code's OTEL_LOGS_EXPORTER without a
    // traces exporter) carry no trace context. The wire-level fix accepts
    // them, but folding them here would aggregate every context-less log per tenant
    // under the same empty aggregateId — surfacing a single nameless
    // "trace" in the messages list that grows unboundedly. Skip the fold;
    // Canonical storage is handled by the dedicated log pipeline.
    if (!event.data.traceId || !event.data.spanId) {
      return state;
    }

    const logIO = extractIOFromLogRecord(event.data, this.traceCanonicalisation);

    const liftedAttributes = this.traceCanonicalisation.canonicalizeLogRecord({
      scopeName: event.data.scopeName,
      body: event.data.body,
      attributes: event.data.attributes,
    }).attributes;

    return applyLogContribution({
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
    return applyLogContribution({
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
}
