import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
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
import {
  METRIC_EXEMPLAR_CORRELATION_COUNT_ATTRIBUTE,
  TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
} from "../schemas/constants";
import type {
  AnnotationAddedEvent,
  AnnotationRemovedEvent,
  AnnotationsBulkSyncedEvent,
  LogContributedEvent,
  LogRecordReceivedEvent,
  MetricDataPointCorrelatedEvent,
  OriginResolvedEvent,
  SpanReceivedEvent,
  TopicAssignedEvent,
  TraceNameChangedEvent,
} from "../schemas/events";
import {
  annotationAddedEventSchema,
  annotationRemovedEventSchema,
  annotationsBulkSyncedEventSchema,
  logContributedEventSchema,
  logRecordReceivedEventSchema,
  metricDataPointCorrelatedEventSchema,
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
export const RESERVED_CACHE_READ_TOKENS =
  "langwatch.reserved.cache_read_tokens";
export const RESERVED_CACHE_CREATION_TOKENS =
  "langwatch.reserved.cache_creation_tokens";
export const RESERVED_REASONING_TOKENS = "langwatch.reserved.reasoning_tokens";
/**
 * Anthropic's cache-creation split by TTL, summed across the trace's model
 * calls. The split rides ONLY the api_response_body log events (no span
 * attribute carries it), so unlike the read/creation totals above these sums
 * accumulate on the LOG contribution path, which also means summing them
 * there can never double-count a span-side number.
 */
export const RESERVED_CACHE_CREATION_5M_TOKENS =
  "langwatch.reserved.cache_creation_5m_tokens";
export const RESERVED_CACHE_CREATION_1H_TOKENS =
  "langwatch.reserved.cache_creation_1h_tokens";

/**
 * The two prices a trace can have, kept apart so the fold can prefer one
 * without losing the other.
 *
 * `ESTIMATED` is the running sum of what our token x registry arithmetic makes
 * of each span. `PROVIDER` is the running sum of what the agent itself says it
 * was charged, lifted per call off its own reporting (Claude Code's `cost_usd`
 * on the api_request event). {@link resolveTraceCost} picks between them, and
 * `totalCost` on the state carries the winner, so every reader of a trace's
 * cost sees the same number.
 */
export const RESERVED_ESTIMATED_COST_USD =
  "langwatch.reserved.estimated_cost_usd";
export const RESERVED_ESTIMATED_NON_BILLED_COST_USD =
  "langwatch.reserved.estimated_non_billed_cost_usd";
export const RESERVED_PROVIDER_COST_USD =
  "langwatch.reserved.provider_cost_usd";
export const RESERVED_PROVIDER_NON_BILLED_COST_USD =
  "langwatch.reserved.provider_non_billed_cost_usd";

/**
 * The context the trace's first model call already carried, and the start time
 * of the call that set it (bookkeeping, so a later-arriving earlier span can
 * still win). See {@link recordContextSize}.
 */
export const RESERVED_CONTEXT_SIZE_TOKENS =
  "langwatch.reserved.context_size_tokens";
export const RESERVED_CONTEXT_SIZE_AT_MS =
  "langwatch.reserved.context_size_at_ms";

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

/** Add a positive per-span delta onto a reserved running-sum attribute. */
function addReservedTokenSum(
  attributes: Record<string, string>,
  key: string,
  delta: number,
): void {
  if (delta <= 0) return;
  const prior = Number(attributes[key] ?? "0");
  attributes[key] = String((Number.isFinite(prior) ? prior : 0) + delta);
}

/** Read a reserved running-sum attribute back as a number. */
export function readReservedSum(
  attributes: Record<string, string>,
  key: string,
): number {
  const value = Number(attributes[key] ?? "0");
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Costs are money: keep them at six decimals rather than float residue. */
function roundCost(value: number): number | null {
  return value > 0 ? Number(value.toFixed(6)) : null;
}

/**
 * The trace's cost, preferring what the agent says it was charged over what we
 * estimate from its tokens.
 *
 * An estimate is arithmetic over a price registry; a reported cost is the
 * price. When an agent reports per call, and Claude Code does on every
 * api_request event, the sum of those is the trace's cost; the estimate is
 * only the fallback for traces whose agent tells us nothing.
 *
 * This is all-or-nothing per trace on purpose. An agent that reports cost
 * reports it for every call it makes, so a trace either has reported costs
 * covering its calls or has none at all; there is no half-covered trace to
 * reconcile, and reconciling one would mean pairing each log back to its span
 * inside the fold.
 *
 * The bundled split follows the same source, so a subscription-covered session
 * cannot end up with a reported total priced against an estimated non-billed
 * portion, which would invent a billed remainder out of the gap between them.
 */
export function accumulateLogCost({
  attributes,
  liftedAttributes,
  nonBillable,
}: {
  attributes: Record<string, string>;
  liftedAttributes: Record<string, unknown>;
  nonBillable: boolean;
}): { totalCost: number | null; nonBilledCost: number | null } {
  const add = (estimateKey: string, providerKey: string, value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    addReservedTokenSum(attributes, estimateKey, value);
    if (nonBillable) addReservedTokenSum(attributes, providerKey, value);
  };

  // A log-only emitter (Path B) has no span to price, so its cost IS the
  // estimate for that call.
  add(
    RESERVED_ESTIMATED_COST_USD,
    RESERVED_ESTIMATED_NON_BILLED_COST_USD,
    Number(liftedAttributes["langwatch.cost.usd"]),
  );
  // What the agent itself reports having been charged for one model call,
  // which also has its own span the span path priced by estimate. The two
  // never sum: resolveTraceCost picks the reported figure.
  add(
    RESERVED_PROVIDER_COST_USD,
    RESERVED_PROVIDER_NON_BILLED_COST_USD,
    Number(liftedAttributes[ATTR_KEYS.LANGWATCH_PROVIDER_REPORTED_COST_USD]),
  );

  return resolveTraceCost(attributes);
}

export function resolveTraceCost(attributes: Record<string, string>): {
  totalCost: number | null;
  nonBilledCost: number | null;
} {
  const providerCost = readReservedSum(attributes, RESERVED_PROVIDER_COST_USD);
  if (providerCost > 0) {
    return {
      totalCost: roundCost(providerCost),
      nonBilledCost: roundCost(
        readReservedSum(attributes, RESERVED_PROVIDER_NON_BILLED_COST_USD),
      ),
    };
  }
  return {
    totalCost: roundCost(
      readReservedSum(attributes, RESERVED_ESTIMATED_COST_USD),
    ),
    nonBilledCost: roundCost(
      readReservedSum(attributes, RESERVED_ESTIMATED_NON_BILLED_COST_USD),
    ),
  };
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
  const contextTokens =
    cacheTokens.cacheReadTokens + cacheTokens.cacheCreationTokens;
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
  // The running ESTIMATE is what accumulates span by span; `state.totalCost`
  // holds the resolved figure, which is the provider's own once it reports
  // one, so feeding that back in would compound the two sources.
  const tokens = spanCostService.accumulateTokens({
    state: {
      ...state,
      totalCost: readReservedSum(state.attributes, RESERVED_ESTIMATED_COST_USD),
      nonBilledCost: readReservedSum(
        state.attributes,
        RESERVED_ESTIMATED_NON_BILLED_COST_USD,
      ),
    },
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
    inputMediaRefs: io.inputMediaRefs,
    outputMediaRefs: io.outputMediaRefs,
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
  recordContextSize({ attributes, span, cacheTokens });

  // Park the running estimate where the next span picks it up, then let the
  // provider's own figures win if this trace's agent reported any.
  if (tokens.totalCost !== null) {
    attributes[RESERVED_ESTIMATED_COST_USD] = String(tokens.totalCost);
  }
  if (tokens.nonBilledCost !== null) {
    attributes[RESERVED_ESTIMATED_NON_BILLED_COST_USD] = String(
      tokens.nonBilledCost,
    );
  }
  const resolvedCost = resolveTraceCost(attributes);

  const newModels = spanCostService.extractModelsFromSpan(span);
  const models = mergeModelsMostRecentFirst(state.models, newModels);

  // Surface the span-derived models as trace-level metadata (primary +
  // set) so `trace.metadata.model` is populated for API consumers and
  // metadata filters, not just the Models column.
  traceAttributeAccumulationService.stampModelMetadata({ attributes, models });

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
    ...resolvedCost,
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
}: {
  state: TraceSummaryData;
  contribution: LogContribution;
}): TraceSummaryData {
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

  if (
    contribution.input !== null &&
    (computedInput === null || currentInputIsFallback)
  ) {
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
      mergedAttributes["langwatch.reserved.output_source"] =
        OUTPUT_SOURCE.INFERRED;
      delete mergedAttributes["langwatch.reserved.output_is_fallback"];
    }
  }

  // The per-TTL cache-creation lift is a PER-CALL value that must accumulate,
  // not overwrite: sum it into the reserved running totals and keep the
  // per-call keys out of the generic last-write-wins merge below.
  const cacheCreation5m = Number(
    contribution.liftedAttributes[
      ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_5M_INPUT_TOKENS
    ],
  );
  if (Number.isFinite(cacheCreation5m)) {
    addReservedTokenSum(
      mergedAttributes,
      RESERVED_CACHE_CREATION_5M_TOKENS,
      cacheCreation5m,
    );
  }
  const cacheCreation1h = Number(
    contribution.liftedAttributes[
      ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_1H_INPUT_TOKENS
    ],
  );
  if (Number.isFinite(cacheCreation1h)) {
    addReservedTokenSum(
      mergedAttributes,
      RESERVED_CACHE_CREATION_1H_TOKENS,
      cacheCreation1h,
    );
  }

  // The lifts are merged into mergedAttributes here so the reserved +
  // log_count keys set above remain intact.
  for (const [key, value] of Object.entries(contribution.liftedAttributes)) {
    if (
      key === ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_5M_INPUT_TOKENS ||
      key === ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_1H_INPUT_TOKENS ||
      key === ATTR_KEYS.LANGWATCH_PROVIDER_REPORTED_COST_USD
    ) {
      continue;
    }
    mergedAttributes[key] = String(value);
  }

  let models = state.models;
  let totalPromptTokenCount = state.totalPromptTokenCount;
  let totalCompletionTokenCount = state.totalCompletionTokenCount;
  const model = contribution.liftedAttributes["langwatch.model"];
  if (typeof model === "string" && model.length > 0) {
    models = mergeModelsMostRecentFirst(models, [model]);
  }
  const { totalCost, nonBilledCost } = accumulateLogCost({
    attributes: mergedAttributes,
    liftedAttributes: contribution.liftedAttributes,
    nonBillable: contribution.nonBillable,
  });
  const inputTokens = Number(
    contribution.liftedAttributes["langwatch.input_tokens"],
  );
  if (Number.isFinite(inputTokens) && inputTokens > 0) {
    totalPromptTokenCount = (totalPromptTokenCount ?? 0) + inputTokens;
  }
  const outputTokens = Number(
    contribution.liftedAttributes["langwatch.output_tokens"],
  );
  if (Number.isFinite(outputTokens) && outputTokens > 0) {
    totalCompletionTokenCount = (totalCompletionTokenCount ?? 0) + outputTokens;
  }

  // Same trace-level model metadata stamp the span path applies, so
  // log-only (Path B) traces also surface `metadata.model`.
  traceAttributeAccumulationService.stampModelMetadata({
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
   * specs/event-sourcing/hot-trace-fold-amplification.feature).
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
    // them, but folding them here would aggregate every context-less log per tenant
    // under the same empty aggregateId — surfacing a single nameless
    // "trace" in the messages list that grows unboundedly. Skip the fold;
    // Canonical storage is handled by the dedicated log pipeline.
    if (!event.data.traceId || !event.data.spanId) {
      return state;
    }

    const logIO = extractIOFromLogRecord(event.data);

    // Run the canonical extractor registry against this log record.
    // Each extractor (ClaudeCode, Codex, GenAI, SpringAI) claims its
    // own scope/event-name surface and lifts model / cost / tokens /
    // cache / thread.id onto canonical langwatch.* keys. Adding a new
    // platform tool is a one-line addition to the registry plus a new
    // extractor class under canonicalisation/extractors/.
    const liftedAttributes = liftCanonicalAttributesFromLogRecord(event.data);

    return applyLogContribution({
      state,
      contribution: {
        traceId: event.data.traceId,
        input: logIO.input,
        output: logIO.output,
        timeUnixMs: event.data.timeUnixMs,
        liftedAttributes,
        // A log-only emitter has no per-span markers; the receiver stamps the
        // bundled flag on the log record's resource, so classify the whole
        // increment by that.
        nonBillable:
          event.data.resourceAttributes?.[NON_BILLABLE_ATTR] === "true",
      },
    });
  }

  handleTraceLogContributed(
    event: LogContributedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    return applyLogContribution({
      state,
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
        timeToFirstTokenMs === null
          ? ttftMs
          : Math.min(timeToFirstTokenMs, ttftMs);
    }

    // Counts exemplar correlations, not metric data points: the canonical
    // datapoint stream is a separate pipeline this fold never sees, so it
    // cannot know how many points a trace's metrics produced.
    const mergedAttributes = { ...state.attributes };
    const correlationCount = parseInt(
      mergedAttributes[METRIC_EXEMPLAR_CORRELATION_COUNT_ATTRIBUTE] ?? "0",
      10,
    );
    mergedAttributes[METRIC_EXEMPLAR_CORRELATION_COUNT_ATTRIBUTE] = String(
      correlationCount + 1,
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
