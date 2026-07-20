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
import {
  accumulateCodeAgentSummaryFromLog,
  accumulateCodeAgentSummaryFromSpan,
  deriveCodeAgentSessionTitle,
} from "./services/code-agent-summary.service";
import { liftCodingAgentLogFacts } from "./services/coding-agent-normalization";

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
 * Past this many spans a trace stops being EVALUATED — not derived.
 *
 * The 2026-05-28 incident guard: a runaway / reused trace_id can reach tens of
 * thousands of spans, and re-running every ON_MESSAGE monitor per span on a 26k
 * span trace is pure amplification for no added signal. So we drop the WORK
 * (eval dispatch), never the DATA — the spans are still stored, still derived,
 * and the trace stays fully queryable.
 *
 * This used to ALSO cap derivation in the trace-summary and trace-analytics
 * folds, and that was wrong for the very emitter this feature is about. Claude
 * Code's native tracer groups a whole SESSION under one traceId (a real session
 * measured here: 796 spans, 34 model calls, 192 tool runs), so a normal Claude
 * session sails past 512 and every derived field then froze at the cap: cost and
 * tokens under-counted, and the coding-agent summary never saw the FINAL
 * `llm_request` — which is exactly where `stop_reason` lives, so a truncated
 * reply could never be detected. The cap silently corrupted the traces it was
 * least equipped to describe. Derivation is now unbounded; the eval-dispatch
 * guard, which is what the incident was actually about, stays.
 */
export const MAX_EVAL_DISPATCH_SPANS = 512;

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

  // Summarise the WORK a coding-agent interaction did, not just what it said.
  // `ComputedOutput` is one string — the closing remark — so on its own it loses
  // the reads, the edits, the commands, the sub-agents. Counted here as the
  // spans fold, so reads pay nothing. A non-coding-agent span costs one name
  // comparison.
  Object.assign(
    attributes,
    accumulateCodeAgentSummaryFromSpan({ attributes, span }),
  );

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
  /**
   * The scalar coding-agent vocabulary, present only for coding-agent
   * records. Folded onto the `langwatch.code_agent.*` summary attributes;
   * never merged wholesale the way `liftedAttributes` is.
   */
  codingAgentAttributes?: Record<string, string | number | boolean>;
  /** The agent's own generated session title, when this record carried one. */
  sessionTitle?: string;
  /**
   * Set when this record's trace id was minted by LangWatch (a log-only
   * emitter with no trace context) — carried onto the summary so the read
   * path can mark the trace as grouped by LangWatch rather than by a tracer.
   * `derivedFrom` names the grouping key when the ingestion path could name
   * one (`session.id`, `conversation.id`), and stays null when it could not.
   */
  syntheticTrace: { derivedFrom: string | null } | null;
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

  // The lifts are merged into mergedAttributes here so the reserved +
  // log_count keys set above remain intact.
  for (const [key, value] of Object.entries(contribution.liftedAttributes)) {
    mergedAttributes[key] = String(value);
  }

  // Claude splits its facts across signals: the slash command that opened the
  // interaction, a mid-interaction compaction, a failed-and-retried model call
  // exist ONLY as logs — no span carries them.
  if (contribution.codingAgentAttributes) {
    Object.assign(
      mergedAttributes,
      accumulateCodeAgentSummaryFromLog({
        attributes: mergedAttributes,
        logAttributes: contribution.codingAgentAttributes,
      }),
    );
  }

  // Only the TRACE-level marker is carried: a real trace can contain a single
  // context-less record whose SPAN id was minted while its trace id is real,
  // and that must never make the whole trace read as synthetic.
  if (contribution.syntheticTrace) {
    mergedAttributes["langwatch.trace.synthetic"] = "true";
    if (contribution.syntheticTrace.derivedFrom) {
      mergedAttributes["langwatch.trace.derived_from"] =
        contribution.syntheticTrace.derivedFrom;
    }
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

  // Claude Code's own generated session title beats the raw root-span name
  // ("claude_code.interaction" reads as an implementation detail, not a
  // title) — but never a name the USER already set. `traceNameFromFallback`
  // clears so a later root span can't stomp it back to the span name.
  const sessionTitle =
    state.traceNameUserOverridden || !contribution.sessionTitle
      ? null
      : contribution.sessionTitle;

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
    ...(sessionTitle !== null
      ? { traceName: sessionTitle, traceNameFromFallback: false }
      : {}),
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
  readonly options = { refoldOnOutOfOrder: false } as const;

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
        codingAgentAttributes:
          liftCodingAgentLogFacts({
            scopeName: event.data.scopeName,
            attributes: event.data.attributes,
          }) ?? undefined,
        sessionTitle:
          deriveCodeAgentSessionTitle(event.data.attributes) ?? undefined,
        // The legacy receiver stamps the marker straight onto the record's
        // attributes; the canonical path carries it as correlationSource.
        syntheticTrace:
          event.data.attributes["langwatch.trace.synthetic"] === "true"
            ? {
                derivedFrom:
                  event.data.attributes["langwatch.trace.derived_from"] ?? null,
              }
            : null,
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
        codingAgentAttributes: event.data.codingAgentAttributes,
        sessionTitle: event.data.sessionTitle,
        syntheticTrace:
          event.data.correlationSource === "claude_synthesized"
            ? { derivedFrom: "session.id" }
            : event.data.correlationSource === "codex_synthesized"
              ? { derivedFrom: "conversation.id" }
              : null,
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
