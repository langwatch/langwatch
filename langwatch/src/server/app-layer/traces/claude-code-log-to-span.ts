/**
 * Claude Code log-record → gen_ai span converter (write-path).
 *
 * Claude Code 2.x emits its model calls as OTLP LOG records, not spans
 * (scope `com.anthropic.claude_code.events`). It logs one model call as three
 * events, split in time:
 *
 *   - api_request        anchor (call END): model, input/output/cache tokens,
 *                        cost_usd, duration_ms, request_id, query_source,
 *                        session.id
 *   - api_request_body   the request payload at call START -> gen_ai.input.messages
 *   - api_response_body  the response payload at call END  -> gen_ai.completion
 *
 * and one tool call as two events: `tool_decision` (claude chose to run a tool)
 * and `tool_result` (terminal: tool name, input, duration, success).
 *
 * Because the OTLP exporter flushes on an interval, any model call longer than
 * that interval — which is every tool-using turn — has its request body (START)
 * delivered in an earlier export batch than its anchor + response (END). A
 * per-batch converter can never rejoin those halves. So this converter is run
 * over the WHOLE TURN's saved logs (the receiver records the claude logs to
 * stored_log_records and a reactor re-folds them); the trace is keyed per turn
 * (`traceId = sha256(session.id:prompt.id)`), so a turn's log set is one turn's
 * worth of records and every batch is already visible when it is folded.
 *
 * A turn's log set is NOT assumed small: one pathological agentic turn can drive
 * thousands of tool/model calls. The span-sync reactor bounds the conversion at
 * {@link CLAUDE_TURN_LOG_CAP} records (in turn order) and passes the drop count
 * here as `truncation`, so a runaway turn can neither seize the worker nor build
 * an unbounded span tree. When the cap bites, the root span carries
 * {@link CLAUDE_TRUNCATED_LOGS_ATTR} and {@link CLAUDE_DROPPED_LOG_COUNT_ATTR} so
 * the truncation is observable at read.
 *
 * Idempotency (load-bearing). The fold re-runs over the turn's growing log set,
 * so a given call is converted many times as more of its parts arrive. Spans
 * land in `stored_spans`, a `ReplacingMergeTree(StartTime)` ORDER BY (TenantId,
 * TraceId, SpanId) whose read path dedups on `max(StartTime)` per SpanId. Two
 * rules keep that convergent:
 *   1. Stable identity: a call's SpanId is the anchor's own synthesized SpanId;
 *      a tool span's SpanId is `sha256(trace:tool:toolUseId)`. Re-deriving the
 *      same call yields the same SpanId, so the store dedups it.
 *   2. Completeness wins: a span's emitted StartTime is its real start minus a
 *      tiny per-missing-part nudge (<= 2ms), so a later, MORE complete version
 *      of the same span (e.g. a tool span that gains its output once the next
 *      model call's transcript arrives) has a strictly greater StartTime and
 *      wins both the read's `max(StartTime)` and the RMT merge. Without this a
 *      grown-in-place span would tie its earlier, partial self at a fixed
 *      StartTime and the merge would keep an arbitrary one (lost output).
 * A model span is only emitted once its anchor is present (the anchor carries
 * the stable id + timing); a request/response body with no anchor in the set
 * contributes to the eventual span but is never emitted on its own, which kills
 * the orphan-body duplicate by construction.
 *
 * Tool output. Claude's telemetry never carries a tool's stdout (no field, no
 * env var — see project_claude_tool_output_no_env_var). The only place a tool's
 * result appears is the NEXT model call's request body, as a `tool_result`
 * block keyed by `tool_use_id`. Folding over the full turn lets us recover it
 * from there and attach it to the tool span's output. The deciding model call's
 * own OUTPUT is its `tool_use` block, read straight from its response body.
 *
 * Cost is handled by the existing span pipeline. We set
 * `langwatch.span.cost = cost_usd` from Anthropic's own reported figure, which
 * computeSpanCost trusts (priority 2) over its token×registry estimate — so
 * every claude turn is costed from Anthropic's authoritative number, on-table
 * or off. The static price table is the fallback for turns that arrive without
 * a cost_usd.
 */

import { createHash } from "node:crypto";

import { capPayloadString } from "~/server/event-sourcing/pipelines/trace-processing/utils/capOversizedLogRecord";
import type {
  OtlpInstrumentationScope,
  OtlpKeyValue,
  OtlpResource,
  OtlpSpan,
} from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import { ATTR_KEYS } from "./canonicalisation/extractors/_constants";
import {
  buildInputMessagesFromRequestBody,
  collectToolResultsFromRequestBody,
  extractAssistantOutputFromResponseBody,
  extractAssistantTextFromResponseBody,
  isConversationalQuerySource,
} from "./canonicalisation/extractors/claudeCode";
import {
  type ClaudeTurnConversionState,
  type ClaudeTurnCursor,
  type ClaudeTurnRootState,
  carriedToRecord,
  emptyClaudeTurnConversionState,
  recordToCarried,
} from "./claude-code-turn-conversion.state";

export const CLAUDE_CODE_EVENT_SCOPE = "com.anthropic.claude_code.events";

/**
 * The three claude_code log events that describe one model call and are folded
 * into a single gen_ai span. Everything else under the claude_code scope stays
 * a log.
 */
export const CLAUDE_CODE_CONVERTIBLE_EVENTS: ReadonlySet<string> = new Set([
  "api_request",
  "api_request_body",
  "api_response_body",
]);

/**
 * The two claude_code log events that describe one tool invocation and are
 * folded into a single `tool` span: `tool_decision` (the permission decision +
 * source) and `tool_result` (the terminal event carrying tool name, input,
 * duration, success). Without these the Bash / Edit / Read calls a coding turn
 * makes never appear as waterfall nodes — the trace would show the model spans
 * but not what the agent actually DID. Paired by `tool_use_id` (both carry it).
 */
export const CLAUDE_CODE_TOOL_EVENTS: ReadonlySet<string> = new Set([
  "tool_decision",
  "tool_result",
]);

export function isClaudeCodeConvertibleLog(
  scopeName: string,
  eventName: string | undefined,
): boolean {
  return (
    scopeName === CLAUDE_CODE_EVENT_SCOPE &&
    eventName !== undefined &&
    CLAUDE_CODE_CONVERTIBLE_EVENTS.has(eventName)
  );
}

export function isClaudeCodeToolLog(
  scopeName: string,
  eventName: string | undefined,
): boolean {
  return (
    scopeName === CLAUDE_CODE_EVENT_SCOPE &&
    eventName !== undefined &&
    CLAUDE_CODE_TOOL_EVENTS.has(eventName)
  );
}

/**
 * Attribute the receiver stamps on every claude_code log it saves that the
 * span fold consumes, so (a) the span-sync reactor can find a turn's logs and
 * (b) the trace read path can hide the raw rows that became spans. The value is
 * the kind of span the log feeds, from {@link claudeCodeLogKind}.
 */
export const CLAUDE_CODE_KIND_ATTR = "langwatch.claude_code.kind";

/**
 * The PII redaction level the receiver used at ingest, stamped on each saved
 * claude_code log so the span-sync reactor redacts the derived spans at the
 * same level the trapped-span path used to (the reactor has no request context).
 */
export const CLAUDE_CODE_PII_ATTR = "langwatch.claude_code.pii";

/**
 * Retention (in days) for the raw claude_code logs the span fold consumes. Once
 * the claudeCodeSpanSync reactor folds a turn's logs into stored_spans the raw
 * rows are pure duplication — every field they carried now lives on the spans,
 * including the full request/response bodies. The fold re-reads the WHOLE turn's
 * log set on each incremental batch, so this floor must outlast the longest
 * single turn plus any late-arriving export batches; one day clears a marathon
 * agentic turn by a wide margin while being far shorter than the platform
 * default retention. The existing `IF(_retention_days > 0, …) DELETE` TTL on
 * stored_log_records does the GC — we just stamp this shorter value on the
 * claude-kind rows at insert. Day granularity is the floor of that mechanism;
 * going sub-day would risk clipping a long turn mid-fold, so one day is the
 * sweet spot.
 */
export const CLAUDE_CODE_LOG_RETENTION_DAYS = 1;

/**
 * Maximum number of a turn's marked log records the span-sync conversion folds
 * in one pass. One pathological agentic turn can stream thousands of tool/model
 * calls; without a bound the reactor re-reads and re-converts the whole growing
 * set on every debounce, seizing the worker and building an unbounded span tree.
 * The reactor fetches at most `cap + 1` records (in turn order), converts the
 * first `cap`, and stamps the root span with the truncation attributes below so
 * the drop is observable. Generous enough that a normal turn is never clipped;
 * an operator can raise it via `LANGWATCH_CLAUDE_TURN_LOG_CAP`.
 */
export const CLAUDE_TURN_LOG_CAP = 2000;

/**
 * Upper bound on the per-turn conversion cap. Keeps an operator-supplied
 * `LANGWATCH_CLAUDE_TURN_LOG_CAP` from re-opening the unbounded-conversion
 * failure mode; a turn never needs more than this many records converted.
 */
export const MAX_CLAUDE_TURN_LOG_CAP = 20000;

/**
 * Max conversion batches one span-sync job runs before yielding. The reactor
 * pages a turn's marked logs in batches of {@link CLAUDE_TURN_LOG_CAP} records,
 * converging a turn of ANY size across passes; this ceiling bounds how much ONE
 * job does so a single pathological turn can never seize the worker. At the
 * defaults one job converts up to `cap × maxBatches` = 50,000 records; a turn
 * larger than that finishes on the next event's debounced job (every record
 * still fires a job, so the last record's job converges the turn). While a job
 * exits still behind, the root span carries the truncation marker, cleared once
 * a later pass catches up.
 */
export const MAX_CONVERSION_BATCHES_PER_JOB = 25;

/** Upper bound on the operator-supplied max-batches override. */
export const MAX_CLAUDE_TURN_MAX_BATCHES = 500;

/**
 * TTL (seconds) for the per-turn conversion state in Redis (48h). Outlasts the
 * longest single turn plus late-arriving export batches; refreshed on every
 * write so an active turn's state never expires mid-conversion. Well under the
 * platform default so an abandoned turn's state is reclaimed.
 */
export const CLAUDE_TURN_CONVERSION_STATE_TTL_SECONDS = 48 * 60 * 60;

/**
 * Root-span attribute set to `true` when a turn's log set exceeded
 * {@link CLAUDE_TURN_LOG_CAP} and the conversion was bounded, so the truncation
 * is observable in the trace. Named under the existing `langwatch.claude_code.*`
 * convention shared with {@link CLAUDE_CODE_KIND_ATTR}/{@link CLAUDE_CODE_PII_ATTR}.
 */
export const CLAUDE_TRUNCATED_LOGS_ATTR = "langwatch.claude_code.truncated_logs";

/**
 * Root-span attribute carrying how many of a turn's marked log records were
 * dropped when the conversion was bounded (>= 1 whenever
 * {@link CLAUDE_TRUNCATED_LOGS_ATTR} is set). The exact count when the reactor's
 * uncapped count query succeeds; a lower bound (>= 1) when that query fails and
 * the reactor falls back to `fetched - cap` (only the `cap + 1` fetch is known).
 */
export const CLAUDE_DROPPED_LOG_COUNT_ATTR =
  "langwatch.claude_code.dropped_log_count";

/**
 * Resolve the operator-configured per-turn conversion cap from an env value,
 * clamped to `[1, MAX_CLAUDE_TURN_LOG_CAP]`. Absent, non-numeric, or below-one
 * values fall back to {@link CLAUDE_TURN_LOG_CAP}. Mirrors the parse semantics of
 * the shard-count env resolvers.
 */
export function resolveClaudeTurnLogCap(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return CLAUDE_TURN_LOG_CAP;
  return Math.min(parsed, MAX_CLAUDE_TURN_LOG_CAP);
}

/**
 * Resolve the operator-configured max conversion batches per job from an env
 * value, clamped to `[1, MAX_CLAUDE_TURN_MAX_BATCHES]`. Absent, non-numeric, or
 * below-one values fall back to {@link MAX_CONVERSION_BATCHES_PER_JOB}.
 */
export function resolveClaudeTurnMaxBatches(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return MAX_CONVERSION_BATCHES_PER_JOB;
  }
  return Math.min(parsed, MAX_CLAUDE_TURN_MAX_BATCHES);
}

/**
 * The span kind a claude_code log event feeds, or null when the event is not
 * folded into a span (so it stays a plain, visible log). The receiver marks +
 * saves every event with a non-null kind; the reactor folds them; the read path
 * hides them. Only mark an event once the converter actually produces its span,
 * or it would be hidden from the log view without a span to replace it.
 */
export function claudeCodeLogKind(
  scopeName: string,
  eventName: string | undefined,
): string | null {
  if (scopeName !== CLAUDE_CODE_EVENT_SCOPE || eventName === undefined) {
    return null;
  }
  if (CLAUDE_CODE_CONVERTIBLE_EVENTS.has(eventName)) return "model";
  if (CLAUDE_CODE_TOOL_EVENTS.has(eventName)) return "tool";
  if (eventName === "user_prompt") return "turn";
  return null;
}

/** A claude_code log record pulled out of the log path for conversion. */
export interface ClaudeCodeLogRecordInput {
  traceId: string;
  spanId: string;
  timeUnixMs: number;
  eventName: string;
  attrs: Record<string, string>;
  resource: OtlpResource | null;
  instrumentationScope: OtlpInstrumentationScope | null;
}

/** A synthesized span ready to feed into recordSpan, carrying its OTLP envelope. */
export interface SynthesizedClaudeSpan {
  span: OtlpSpan;
  resource: OtlpResource | null;
  instrumentationScope: OtlpInstrumentationScope | null;
}

const SPAN_KIND_CLIENT = "SPAN_KIND_CLIENT" as const;

/**
 * Per-missing-part StartTime penalty (ms). A span emitted while still missing
 * some of its parts starts this many ms earlier per missing part, so a later,
 * more complete version of the SAME span has a strictly greater StartTime and
 * wins the `max(StartTime)` read dedup + RMT merge. Bounded to <= 2ms total, so
 * it never reorders the waterfall. See the idempotency note in the file header.
 */
const COMPLETENESS_NUDGE_MS = 1;

const strAttr = (key: string, value: string): OtlpKeyValue => ({
  key,
  value: { stringValue: value },
});
const intAttr = (key: string, value: number): OtlpKeyValue => ({
  key,
  value: { intValue: value },
});
const dblAttr = (key: string, value: number): OtlpKeyValue => ({
  key,
  value: { doubleValue: value },
});
const boolAttr = (key: string, value: boolean): OtlpKeyValue => ({
  key,
  value: { boolValue: value },
});

const asNumber = (raw: string | undefined): number | null => {
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

const asNonEmpty = (raw: string | undefined): string | null =>
  typeof raw === "string" && raw.length > 0 ? raw : null;

// ms epoch (~1.7e12) * 1e6 ns exceeds Number.MAX_SAFE_INTEGER, so convert via
// BigInt to keep the nanosecond value exact rather than float-rounded.
const msToUnixNano = (ms: number): string =>
  (BigInt(Math.round(ms)) * 1_000_000n).toString();

const bySequence = (
  a: ClaudeCodeLogRecordInput,
  b: ClaudeCodeLogRecordInput,
): number => {
  if (a.timeUnixMs !== b.timeUnixMs) return a.timeUnixMs - b.timeUnixMs;
  const sa = asNumber(a.attrs["event.sequence"]) ?? 0;
  const sb = asNumber(b.attrs["event.sequence"]) ?? 0;
  return sa - sb;
};

/**
 * The resource + scope of the first record that carries either, so a span
 * rebuilt from carried records (which drop resource/scope to stay compact) takes
 * the batch's turn-uniform resource/scope.
 */
function firstResourceScope(records: ClaudeCodeLogRecordInput[]): {
  resource: OtlpResource | null;
  instrumentationScope: OtlpInstrumentationScope | null;
} {
  for (const record of records) {
    if (record.resource || record.instrumentationScope) {
      return {
        resource: record.resource,
        instrumentationScope: record.instrumentationScope,
      };
    }
  }
  return { resource: null, instrumentationScope: null };
}

function groupByTrace(
  records: ClaudeCodeLogRecordInput[],
): Map<string, ClaudeCodeLogRecordInput[]> {
  const byTrace = new Map<string, ClaudeCodeLogRecordInput[]>();
  for (const record of records) {
    const list = byTrace.get(record.traceId);
    if (list) list.push(record);
    else byTrace.set(record.traceId, [record]);
  }
  return byTrace;
}

/**
 * Convert a turn's claude_code logs into a hierarchy of spans: one ROOT span
 * per turn (the user_prompt, carrying the turn input) with the model-call and
 * tool spans as its children. Feed it the WHOLE turn's saved claude logs so the
 * cross-batch join is complete and tool outputs can be recovered from later
 * model calls' transcripts. Idempotent: re-running over the same (or a grown)
 * set converges on the same spans (see the file header). The root's SpanId is
 * derived from the trace, so every re-fold parents the children under the same
 * root.
 *
 * `promptTextById` maps a `prompt.id` to the clean user-typed text from the
 * co-located `user_prompt` event, used as the turn input when no user_prompt
 * record is in the set or claude truncated the api_request_body inline.
 *
 * `truncation` carries how many of the turn's records the caller dropped to keep
 * the conversion bounded (see {@link CLAUDE_TURN_LOG_CAP}); a positive
 * `droppedLogCount` stamps the root span with {@link CLAUDE_TRUNCATED_LOGS_ATTR}
 * and {@link CLAUDE_DROPPED_LOG_COUNT_ATTR} so the truncation is observable.
 */
export function convertClaudeCodeTurnToSpans(
  records: ClaudeCodeLogRecordInput[],
  promptTextById: ReadonlyMap<string, string> = new Map(),
  truncation: ClaudeTurnTruncation = { droppedLogCount: 0 },
): SynthesizedClaudeSpan[] {
  const out: SynthesizedClaudeSpan[] = [];
  for (const traceRecords of groupByTrace(records).values()) {
    // Whole-turn conversion is incremental-with-empty-state over one batch, so a
    // single conversion core serves both paths (no duplicated join logic). The
    // seed promptTextById is merged into the empty state's map.
    const seed = emptyClaudeTurnConversionState();
    for (const [id, text] of promptTextById) seed.promptTextById[id] = text;
    out.push(
      ...convertTurnBatch({
        traceId: traceRecords[0]!.traceId,
        records: traceRecords,
        state: seed,
        truncation,
      }).spans,
    );
  }
  return out;
}

/** How many of a turn's records were dropped to bound the span conversion. */
export interface ClaudeTurnTruncation {
  droppedLogCount: number;
}

/**
 * Incremental entry point: convert ONE batch of a turn's claude logs against the
 * carried conversion `state`, returning the batch's spans plus the `nextState`
 * to persist for the following batch. The whole-turn function above is exactly
 * this over the empty state with the whole turn as one batch, so both paths run
 * the same {@link convertTurnBatch} core.
 *
 * Cross-batch joins are completed by re-emitting the carried records (an anchor
 * still missing a body/response, an orphan body/response, a tool event whose
 * output has not yet been recovered) alongside the new batch: the deterministic
 * span ids + completeness nudge make the later, more complete emission win the
 * stored_spans ReplacingMergeTree dedup, so the turn converges regardless of how
 * the records were partitioned into batches.
 */
export function convertClaudeCodeTurnToSpansIncremental({
  traceId,
  records,
  state,
  truncation = { droppedLogCount: 0 },
}: {
  traceId: string;
  records: ClaudeCodeLogRecordInput[];
  state: ClaudeTurnConversionState;
  truncation?: ClaudeTurnTruncation;
}): { spans: SynthesizedClaudeSpan[]; nextState: ClaudeTurnConversionState } {
  return convertTurnBatch({ traceId, records, state, truncation });
}

/**
 * The single conversion core. Merges the carried records with this batch, runs
 * the model + tool joins over the combined set, re-parents every produced span
 * under the deterministic root, re-emits the root from accumulated state + this
 * batch, and computes the next state (advanced cursor, updated root
 * accumulators, refreshed prompt map, and the records still awaiting a join
 * partner as the next carry set).
 */
function convertTurnBatch({
  traceId,
  records,
  state,
  truncation,
}: {
  traceId: string;
  records: ClaudeCodeLogRecordInput[];
  state: ClaudeTurnConversionState;
  truncation: ClaudeTurnTruncation;
}): { spans: SynthesizedClaudeSpan[]; nextState: ClaudeTurnConversionState } {
  // Deterministic per-turn root id so every re-fold parents children identically.
  const rootSpanId = createHash("sha256")
    .update(`${traceId}:claude_root`)
    .digest("hex")
    .slice(0, 16);

  // Prompt map: carried entries plus any user_prompt in this batch. A later
  // model call whose request body claude truncated inline reads its input here.
  const promptTextById = new Map<string, string>(
    Object.entries(state.promptTextById),
  );
  for (const record of records) {
    if (record.eventName !== "user_prompt") continue;
    const promptId = asNonEmpty(record.attrs["prompt.id"]);
    const promptText = asNonEmpty(record.attrs.prompt);
    if (promptId && promptText) promptTextById.set(promptId, promptText);
  }

  // Combine the carried records (projected back to full shape) with this batch.
  // The carried set is what makes a cross-batch join complete on a later pass.
  // Carried records drop resource/scope to stay compact; backfill them from this
  // batch (turn-uniform: same session + service), so a re-emitted carried span
  // carries the same resource/scope the batch that OWNS the record emitted.
  const batchResourceScope = firstResourceScope(records);
  const carried = state.carryRecords.map((c) => {
    const record = carriedToRecord(c, traceId);
    record.resource = batchResourceScope.resource;
    record.instrumentationScope = batchResourceScope.instrumentationScope;
    return record;
  });
  const combined = [...carried, ...records];

  const model = buildModelSpansForTrace(combined, promptTextById);
  const tool = buildToolSpansForTrace(combined);
  const children = [...model.spans, ...tool.spans];
  for (const child of children) child.span.parentSpanId = rootSpanId;

  // The next carry set: records whose span could still change on a later batch.
  // Deduped by identity so a record carried twice (still unresolved) stays once.
  const nextCarry = dedupeCarry([...model.unresolved, ...tool.unresolved]);

  // Progress counters advance by this batch's OWN new terminal records (an
  // api_request anchor, a tool_result), never by carried re-emissions, so the
  // count is the distinct total at convergence (each record lands in exactly one
  // batch), the monotonic, partition-invariant driver for the root nudge.
  const newAnchors = records.filter(
    (r) => r.eventName === "api_request",
  ).length;
  const newToolResults = records.filter(
    (r) => r.eventName === "tool_result",
  ).length;

  const nextRoot = accumulateRoot({
    prev: state.root,
    batch: records,
    combined,
    children,
    newAnchors,
    newToolResults,
    promptTextById,
  });

  const cursor = advanceCursor(state.cursor, records);

  const nextState: ClaudeTurnConversionState = {
    cursor,
    carryRecords: nextCarry.map(recordToCarried),
    promptTextById: Object.fromEntries(promptTextById),
    root: nextRoot,
  };

  // The turn has real content once any model/tool call has ever been converted.
  const turnHasContent =
    nextRoot.modelCallCount + nextRoot.toolCallCount > 0;

  if (children.length === 0 && !turnHasContent) {
    // Nothing convertible yet (e.g. only a user_prompt so far): no root without
    // content, but the accumulated state still advances so a later batch that
    // brings the first model/tool call can build the root from it.
    return { spans: [], nextState };
  }

  // Emit the root whenever the turn has content, even if THIS batch produced no
  // new child spans (a catch-up pass completing tool outputs, or a truncation
  // re-stamp over an empty batch): the children dispatched on prior passes
  // persist in stored_spans, and the root re-emits idempotently under its stable
  // id with the accumulated envelope + the current truncation flag.
  const root = buildRootSpanFromState({
    traceId,
    rootSpanId,
    children,
    root: nextRoot,
    combined,
    truncation,
  });
  return { spans: [root, ...children], nextState };
}

/** Advance the cursor to the batch's last record in (time, sequence) order. */
function advanceCursor(
  prev: ClaudeTurnCursor,
  batch: ClaudeCodeLogRecordInput[],
): ClaudeTurnCursor {
  let cursor = prev;
  for (const record of batch) {
    const sequence = asNumber(record.attrs["event.sequence"]) ?? 0;
    if (
      record.timeUnixMs > cursor.timeUnixMs ||
      (record.timeUnixMs === cursor.timeUnixMs && sequence > cursor.sequence)
    ) {
      cursor = { timeUnixMs: record.timeUnixMs, sequence };
    }
  }
  return cursor;
}

/** Dedupe carried records by (eventName, ordering, key attrs) identity. */
function dedupeCarry(
  records: ClaudeCodeLogRecordInput[],
): ClaudeCodeLogRecordInput[] {
  const seen = new Set<string>();
  const out: ClaudeCodeLogRecordInput[] = [];
  for (const record of records) {
    const key = [
      record.eventName,
      record.timeUnixMs,
      record.attrs["event.sequence"] ?? "",
      record.attrs.request_id ?? "",
      record.attrs.tool_use_id ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

/**
 * Build the model-call (gen_ai) spans from a turn's claude_code logs. Filters
 * the convertible events (api_request / api_request_body / api_response_body)
 * out of `records` itself, so it is safe to pass the whole turn's record set.
 */
export function convertClaudeCodeLogsToSpans(
  records: ClaudeCodeLogRecordInput[],
  promptTextById: ReadonlyMap<string, string> = new Map(),
): SynthesizedClaudeSpan[] {
  const out: SynthesizedClaudeSpan[] = [];
  for (const traceRecords of groupByTrace(records).values()) {
    out.push(...buildModelSpansForTrace(traceRecords, promptTextById).spans);
  }
  return out;
}

/**
 * The model spans for a set of records, plus the records whose span is not yet
 * complete and must be re-fed on a later batch: an anchor still missing its
 * request body or response (its span improves once the missing half lands) and
 * an orphan body / response with no anchor yet (it is never emitted alone but
 * pairs with its anchor when that anchor arrives).
 */
function buildModelSpansForTrace(
  records: ClaudeCodeLogRecordInput[],
  promptTextById: ReadonlyMap<string, string>,
): {
  spans: SynthesizedClaudeSpan[];
  unresolved: ClaudeCodeLogRecordInput[];
} {
  const anchors = records
    .filter((r) => r.eventName === "api_request")
    .sort(bySequence);
  const bodies = records
    .filter((r) => r.eventName === "api_request_body")
    .sort(bySequence);
  const responses = records
    .filter((r) => r.eventName === "api_response_body")
    .sort(bySequence);

  const usedBodies = new Set<number>();
  const usedResponses = new Set<number>();
  const spans: SynthesizedClaudeSpan[] = [];
  const unresolved: ClaudeCodeLogRecordInput[] = [];

  for (const anchor of anchors) {
    // OUTPUT join: exact request_id match (consume-once). The response and the
    // anchor are both logged at call END, so over the full turn they pair.
    const requestId = asNonEmpty(anchor.attrs.request_id);
    let response: ClaudeCodeLogRecordInput | null = null;
    if (requestId) {
      const idx = responses.findIndex(
        (r, i) => !usedResponses.has(i) && r.attrs.request_id === requestId,
      );
      if (idx >= 0) {
        response = responses[idx]!;
        usedResponses.add(idx);
      }
    }

    // INPUT join: (model, query_source) consume-once in time order — the body
    // carries no request_id, and query_source keys the pairing so a
    // generate_session_title body never cross-pairs with a repl_main_thread
    // request.
    const model = anchor.attrs.model ?? "";
    const querySource = anchor.attrs.query_source ?? "";
    const bodyIdx = bodies.findIndex(
      (b, i) =>
        !usedBodies.has(i) &&
        (b.attrs.model ?? "") === model &&
        (b.attrs.query_source ?? "") === querySource,
    );
    const body = bodyIdx >= 0 ? bodies[bodyIdx]! : null;
    if (bodyIdx >= 0) usedBodies.add(bodyIdx);

    spans.push(buildModelSpan(anchor, body, response, promptTextById));

    // The anchor's span still improves if a part is missing this pass: carry the
    // anchor (and the parts it DID pair with) so the completeness-nudged re-emit
    // once the missing half lands wins the stored_spans max(StartTime) dedup.
    if (!body || !response) {
      unresolved.push(anchor);
      if (body) unresolved.push(body);
      if (response) unresolved.push(response);
    }
  }

  // A request/response body with no anchor in the set is NOT emitted on its own
  //, it pairs with its anchor once that anchor is in the folded turn. Carry
  // every still-unpaired body/response so a future batch's anchor completes it;
  // this is what removes the cross-batch orphan-body duplicate by construction.
  bodies.forEach((body, i) => {
    if (!usedBodies.has(i)) unresolved.push(body);
  });
  responses.forEach((response, i) => {
    if (!usedResponses.has(i)) unresolved.push(response);
  });

  return { spans, unresolved };
}

function baseAttrs(record: ClaudeCodeLogRecordInput): OtlpKeyValue[] {
  const attrs: OtlpKeyValue[] = [
    strAttr(ATTR_KEYS.SPAN_TYPE, "llm"),
    strAttr(ATTR_KEYS.GEN_AI_SYSTEM, "claude_code"),
  ];
  const sessionId = asNonEmpty(record.attrs["session.id"]);
  if (sessionId) {
    attrs.push(strAttr(ATTR_KEYS.GEN_AI_CONVERSATION_ID, sessionId));
    attrs.push(strAttr(ATTR_KEYS.LANGWATCH_THREAD_ID, sessionId));
  }
  return attrs;
}

/**
 * claude_code api_request attributes already lifted onto canonical gen_ai.* /
 * langwatch.* keys (or whose raw body payload is carried as input/output
 * messages). Everything NOT listed here is copied verbatim under `claude_code.*`
 * so no attribute claude emits is silently dropped.
 */
const CLAUDE_HANDLED_ATTRS = new Set<string>([
  "model", // -> gen_ai.request/response.model
  "input_tokens", // -> gen_ai.usage.input_tokens
  "output_tokens", // -> gen_ai.usage.output_tokens
  "cache_read_tokens", // -> gen_ai.usage.cache_read.input_tokens
  "cache_creation_tokens", // -> gen_ai.usage.cache_creation.input_tokens
  "cost_usd", // -> langwatch.span.cost
  "request_id", // -> gen_ai.response.id
  "effort", // -> gen_ai.request.reasoning_effort
  "session.id", // -> gen_ai.conversation.id + langwatch.thread.id
  "body", // lifted into gen_ai.input/output.messages, not copied raw
  "body_length",
  "body_truncated",
  "service.name", // already gen_ai.system = claude_code
]);

/**
 * Lift the provenance + reasoning knobs claude sends on a model-call event, then
 * capture every remaining attribute under a `claude_code.*` namespace so the
 * span keeps the full telemetry claude emits (speed, query_source, duration_ms,
 * terminal.type, user.id, …) instead of only the canonical token/model subset.
 */
function appendProvenanceAttrs(
  attrs: OtlpKeyValue[],
  record: ClaudeCodeLogRecordInput,
): void {
  const requestId = asNonEmpty(record.attrs.request_id);
  if (requestId) attrs.push(strAttr(ATTR_KEYS.GEN_AI_RESPONSE_ID, requestId));
  const effort = asNonEmpty(record.attrs.effort);
  if (effort) {
    attrs.push(strAttr(ATTR_KEYS.GEN_AI_REQUEST_REASONING_EFFORT, effort));
  }
  for (const [key, value] of Object.entries(record.attrs)) {
    if (CLAUDE_HANDLED_ATTRS.has(key)) continue;
    const clean = asNonEmpty(value);
    if (clean) attrs.push(strAttr(`claude_code.${key}`, clean));
  }
}

/**
 * Resolve the span's `gen_ai.input.messages` (a JSON array of `{ role, content }`)
 * from an api_request_body record. Prefers the full conversation parsed out of
 * the request body (system + every turn); when claude truncated the body inline
 * (`body_truncated=true`, ~60KB cap) it is unparseable JSON, so fall back to the
 * clean co-located `user_prompt` text as the single latest turn. The raw
 * truncated JSON blob is NEVER used as input. Each message's content is capped
 * individually so the array stays valid JSON. Returns null when nothing usable.
 */
function resolveInputMessages(
  body: ClaudeCodeLogRecordInput,
  promptTextById: ReadonlyMap<string, string>,
): string | null {
  const parsed = buildInputMessagesFromRequestBody(body.attrs.body);
  let messages: Array<{ role: string; content: string }> | null = parsed;
  if (!messages) {
    const fallback = asNonEmpty(
      promptTextById.get(body.attrs["prompt.id"] ?? ""),
    );
    messages = fallback ? [{ role: "user", content: fallback }] : null;
  }
  if (!messages) return null;
  const capped = messages.map((m) => ({
    role: m.role,
    content: capPayloadString(m.content, undefined, "claude_input"),
  }));
  return JSON.stringify(capped);
}

/**
 * The span's waterfall name. Conversational turns are named by model (matching
 * the gateway / Path A convention). Non-conversational utility calls
 * (generate_session_title, prompt_suggestion, …) are named by their
 * query_source instead, so the waterfall reads as what the call was FOR rather
 * than a row of mystery model spans that carry no conversation.
 */
function claudeSpanName(
  model: string | null,
  querySource: string | null,
): string {
  if (querySource && !isConversationalQuerySource(querySource)) {
    return querySource;
  }
  return model ?? "llm";
}

function buildModelSpan(
  anchor: ClaudeCodeLogRecordInput,
  body: ClaudeCodeLogRecordInput | null,
  response: ClaudeCodeLogRecordInput | null,
  promptTextById: ReadonlyMap<string, string>,
): SynthesizedClaudeSpan {
  const attrs = baseAttrs(anchor);
  const model = asNonEmpty(anchor.attrs.model);
  if (model) {
    attrs.push(strAttr(ATTR_KEYS.GEN_AI_REQUEST_MODEL, model));
    attrs.push(strAttr(ATTR_KEYS.GEN_AI_RESPONSE_MODEL, model));
  }

  const inputTokens = asNumber(anchor.attrs.input_tokens);
  if (inputTokens !== null)
    attrs.push(intAttr(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS, inputTokens));
  const outputTokens = asNumber(anchor.attrs.output_tokens);
  if (outputTokens !== null)
    attrs.push(intAttr(ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens));
  const cacheRead = asNumber(anchor.attrs.cache_read_tokens);
  if (cacheRead !== null)
    attrs.push(
      intAttr(ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, cacheRead),
    );
  const cacheCreation = asNumber(anchor.attrs.cache_creation_tokens);
  if (cacheCreation !== null)
    attrs.push(
      intAttr(
        ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
        cacheCreation,
      ),
    );

  // Authoritative provider cost (priority 2 in computeSpanCost): Anthropic's
  // own cost_usd is trusted over the token×registry estimate for every claude
  // turn, on-table or off.
  const cost = asNumber(anchor.attrs.cost_usd);
  if (cost !== null) attrs.push(dblAttr(ATTR_KEYS.LANGWATCH_SPAN_COST, cost));

  // request_id, reasoning effort, and every other attribute claude emits.
  appendProvenanceAttrs(attrs, anchor);

  // INPUT: structured conversation parsed from the request body (system + every
  // turn); falls back to the clean user_prompt text when the body was truncated.
  // We ALSO attach the verbatim request body, so the call's full payload (the
  // system prompt, every tool/skill schema, the whole message history with its
  // cache_control markers) is inspectable on the span — that is where the
  // cache_creation / cache_read tokens come from, which the light view hides.
  if (body) {
    const inputMessages = resolveInputMessages(body, promptTextById);
    if (inputMessages) {
      attrs.push(strAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, inputMessages));
    }
    const requestBody = asNonEmpty(body.attrs.body);
    if (requestBody) {
      attrs.push(
        strAttr(
          ATTR_KEYS.CLAUDE_CODE_REQUEST_BODY,
          capPayloadString(requestBody, undefined, "claude_request_body"),
        ),
      );
    }
  }

  // OUTPUT: the assistant's reply, INCLUDING tool_use blocks so a model call
  // whose reply is a tool invocation shows the tool it chose to call rather
  // than an empty output. Attached to every model call (conversational or
  // utility); the trace headline stays conversational-only via the fold's
  // accumulation gate (trace-io-accumulation.service.ts). The verbatim response
  // body rides alongside for the same full-fidelity debugging.
  if (response) {
    const outputText = extractAssistantOutputFromResponseBody(
      response.attrs.body,
    );
    if (outputText) {
      attrs.push(strAttr(ATTR_KEYS.GEN_AI_COMPLETION, outputText));
    }
    const responseBody = asNonEmpty(response.attrs.body);
    if (responseBody) {
      attrs.push(
        strAttr(
          ATTR_KEYS.CLAUDE_CODE_RESPONSE_BODY,
          capPayloadString(responseBody, undefined, "claude_response_body"),
        ),
      );
    }
  }

  // Completeness nudge so a later, more complete version of this same call wins
  // the read's max(StartTime). Missing parts among {body, response} -> earlier.
  const missingParts = (body ? 0 : 1) + (response ? 0 : 1);
  const durationMs = asNumber(anchor.attrs.duration_ms) ?? 0;
  const endMs = anchor.timeUnixMs;
  const startMs = Math.max(
    0,
    endMs - durationMs - missingParts * COMPLETENESS_NUDGE_MS,
  );

  return {
    span: makeSpan({
      traceId: anchor.traceId,
      spanId: anchor.spanId,
      name: claudeSpanName(model, asNonEmpty(anchor.attrs.query_source)),
      startMs,
      endMs,
      attributes: attrs,
    }),
    resource: anchor.resource,
    instrumentationScope: anchor.instrumentationScope,
  };
}

function makeSpan({
  traceId,
  spanId,
  name,
  startMs,
  endMs,
  attributes,
  events = [],
  kind = SPAN_KIND_CLIENT,
}: {
  traceId: string;
  spanId: string;
  name: string;
  startMs: number;
  endMs: number;
  attributes: OtlpKeyValue[];
  events?: OtlpSpan["events"];
  kind?: OtlpSpan["kind"];
}): OtlpSpan {
  return {
    traceId,
    spanId,
    parentSpanId: null,
    name,
    kind,
    startTimeUnixNano: msToUnixNano(startMs),
    endTimeUnixNano: msToUnixNano(endMs),
    attributes,
    events,
    links: [],
    status: { message: null, code: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

/** nanosecond string -> integer milliseconds (exact via BigInt). */
const nanoToMs = (nano: OtlpSpan["startTimeUnixNano"]): number =>
  Number(BigInt(String(nano)) / 1_000_000n);

/**
 * Attributes already lifted onto the root turn span (or used to name it), so
 * they are not re-copied under `claude_code.*`.
 */
const CLAUDE_ROOT_HANDLED_ATTRS = new Set<string>([
  "prompt", // -> langwatch.input
  "session.id", // -> gen_ai.conversation.id + langwatch.thread.id
  "service.name",
  "event.name",
]);

const SPAN_NAME_MAX = 80;

/**
 * Fold this batch's records into the root accumulators. The root agent span is
 * re-emitted every pass from this accumulated state + the current children's
 * time envelope, so a turn spread across batches grows one convergent root
 * rather than a flapping partial one. Accumulators only ever move forward
 * (earliest start, first-seen input/session, latest genuine assistant reply,
 * incrementing counts), so re-running a batch is idempotent.
 */
function accumulateRoot({
  prev,
  batch,
  combined,
  children,
  newAnchors,
  newToolResults,
  promptTextById,
}: {
  prev: ClaudeTurnRootState;
  batch: ClaudeCodeLogRecordInput[];
  combined: ClaudeCodeLogRecordInput[];
  children: SynthesizedClaudeSpan[];
  newAnchors: number;
  newToolResults: number;
  promptTextById: ReadonlyMap<string, string>;
}): ClaudeTurnRootState {
  const userPrompt = batch.find((r) => r.eventName === "user_prompt") ?? null;

  // The turn envelope: earliest record start and latest child end, accumulated
  // across batches so a later batch bringing an earlier-ending span never shrinks
  // the root's end (which re-deriving per batch would).
  let startMs = prev.startMs;
  for (const record of batch) startMs = Math.min(startMs, record.timeUnixMs);
  let endMs = prev.endMs;
  for (const child of children) {
    endMs = Math.max(endMs, nanoToMs(child.span.endTimeUnixNano));
    startMs = Math.min(startMs, nanoToMs(child.span.startTimeUnixNano));
  }

  const input =
    prev.input ??
    asNonEmpty(userPrompt?.attrs.prompt) ??
    asNonEmpty([...promptTextById.values()][0]);

  const sessionId =
    prev.sessionId ??
    asNonEmpty(userPrompt?.attrs["session.id"]) ??
    asNonEmpty(batch.find((r) => r.attrs["session.id"])?.attrs["session.id"]);

  // Provenance is set once from the first user_prompt seen (the turn has one).
  let provenance = prev.provenance;
  if (Object.keys(provenance).length === 0 && userPrompt) {
    provenance = {};
    for (const [key, value] of Object.entries(userPrompt.attrs)) {
      if (CLAUDE_ROOT_HANDLED_ATTRS.has(key)) continue;
      const clean = asNonEmpty(value);
      if (clean) provenance[key] = clean;
    }
  }

  // The latest genuine conversational assistant reply text, for observability on
  // the root. Utility calls (title, autosuggest) are excluded exactly as the
  // trace headline gate does. Read from this batch's responses in wire order.
  let lastAssistantResponse = prev.lastAssistantResponse;
  const responses = combined
    .filter((r) => r.eventName === "api_response_body")
    .sort(bySequence);
  for (const response of responses) {
    if (!isConversationalQuerySource(asNonEmpty(response.attrs.query_source))) {
      continue;
    }
    const text = extractAssistantTextFromResponseBody(response.attrs.body);
    if (text) lastAssistantResponse = text;
  }

  return {
    startMs,
    endMs,
    input: input ?? null,
    lastAssistantResponse: lastAssistantResponse ?? null,
    sessionId: sessionId ?? null,
    provenance,
    modelCallCount: prev.modelCallCount + newAnchors,
    toolCallCount: prev.toolCallCount + newToolResults,
  };
}

/**
 * The turn ROOT span rendered from the accumulated root state + this pass's
 * children. A single parentless span per turn carries the turn input, with the
 * model + tool spans hanging under it, so the trace has a real shape and the
 * fold's input/output gates work off one root. Its timing envelopes its children
 * and the accumulated start. The SpanId is a stable hash of the trace, so every
 * re-fold produces the same root (idempotent upsert).
 */
function buildRootSpanFromState({
  traceId,
  rootSpanId,
  children,
  root,
  combined,
  truncation,
}: {
  traceId: string;
  rootSpanId: string;
  children: SynthesizedClaudeSpan[];
  root: ClaudeTurnRootState;
  combined: ClaudeCodeLogRecordInput[];
  truncation: ClaudeTurnTruncation;
}): SynthesizedClaudeSpan {
  const attrs: OtlpKeyValue[] = [strAttr(ATTR_KEYS.SPAN_TYPE, "agent")];
  if (root.sessionId) {
    attrs.push(strAttr(ATTR_KEYS.GEN_AI_CONVERSATION_ID, root.sessionId));
    attrs.push(strAttr(ATTR_KEYS.LANGWATCH_THREAD_ID, root.sessionId));
  }
  // Mark the turn as truncated when this pass is still behind (more records
  // remain than the batch converted). When a later pass catches up the caller
  // passes droppedLogCount 0 and this block is skipped, so the attribute is
  // omitted on the catch-up re-emission and the UI-visible value flips.
  if (truncation.droppedLogCount > 0) {
    attrs.push(boolAttr(CLAUDE_TRUNCATED_LOGS_ATTR, true));
    attrs.push(intAttr(CLAUDE_DROPPED_LOG_COUNT_ATTR, truncation.droppedLogCount));
  }
  if (root.input) {
    attrs.push(
      strAttr(
        ATTR_KEYS.LANGWATCH_INPUT,
        capPayloadString(root.input, undefined, "claude_input"),
      ),
    );
  }
  // user_prompt provenance (command_name, command_source, prompt_length, …).
  for (const [key, value] of Object.entries(root.provenance)) {
    attrs.push(strAttr(`claude_code.${key}`, value));
  }

  // The root envelope comes from the ACCUMULATED root state (min start, max end
  // across every batch), so a later batch that brings an earlier-ending span
  // never shrinks it and every partition converges to the same envelope.
  let startMs = Number.isFinite(root.startMs) ? root.startMs : 0;
  let endMs = Number.isFinite(root.endMs) ? root.endMs : startMs;
  for (const child of children) {
    startMs = Math.min(startMs, nanoToMs(child.span.startTimeUnixNano));
    endMs = Math.max(endMs, nanoToMs(child.span.endTimeUnixNano));
  }

  const name = rootSpanName(root.input);
  // Resource + scope from the first record that carries them, else the first
  // child's. Carried records drop resource/scope to stay small, so a root built
  // in a pass whose combined set is all carried takes them from a child instead.
  const provenanceSource =
    combined.find((r) => r.resource || r.instrumentationScope) ?? null;
  const resource = provenanceSource?.resource ?? children[0]?.resource ?? null;
  const instrumentationScope =
    provenanceSource?.instrumentationScope ??
    children[0]?.instrumentationScope ??
    null;

  const span = makeSpan({
    traceId,
    spanId: rootSpanId,
    name,
    startMs,
    endMs,
    attributes: attrs,
    kind: "SPAN_KIND_SERVER",
  });
  // Convergence nudge (idempotency, load-bearing). The root's emitted StartTime
  // gains a MONOTONIC per-converted-call offset, in NANOSECONDS, so it is
  // invisible in the millisecond waterfall, so a later root re-emission that has
  // enveloped MORE of the turn has a strictly greater StartTime and wins the
  // stored_spans max(StartTime) read dedup + RMT merge over an earlier, less
  // complete root. The driver (model + tool spans converted so far) only ever
  // increases and converges to the SAME fixpoint for the whole-turn single pass
  // and any batch partition, so they all land the same root. Two roots at the
  // same call count carry identical attributes (a later tool OUTPUT lives on the
  // CHILD span, not the root), so a tie between them is harmless. Without this,
  // the accumulated min-start would make a later, fuller root tie or lose an
  // earlier partial one.
  const progress = root.modelCallCount + root.toolCallCount;
  span.startTimeUnixNano = (
    BigInt(String(span.startTimeUnixNano)) + BigInt(progress)
  ).toString();

  return { span, resource, instrumentationScope };
}

/** A short, readable root name from the user's prompt (first line, capped). */
function rootSpanName(promptText: string | null): string {
  if (!promptText) return "Claude Code";
  const firstLine = promptText.split("\n", 1)[0]?.trim() ?? "";
  if (!firstLine) return "Claude Code";
  return firstLine.length > SPAN_NAME_MAX
    ? `${firstLine.slice(0, SPAN_NAME_MAX - 1)}…`
    : firstLine;
}

/**
 * tool_decision / tool_result attributes already lifted onto canonical
 * gen_ai.tool.* keys (or used for timing). Everything else is copied verbatim
 * under `claude_code.*` so no tool telemetry claude emits (success,
 * duration_ms, decision, *_size_bytes, …) is dropped.
 */
const CLAUDE_TOOL_HANDLED_ATTRS = new Set<string>([
  "tool_name", // -> gen_ai.tool.name + span name
  "tool_use_id", // -> gen_ai.tool.call.id
  "tool_input", // -> langwatch.input
  "tool_parameters", // -> langwatch.input (fallback)
  "session.id", // -> gen_ai.conversation.id + langwatch.thread.id
  "service.name", // already implied (claude_code)
  "event.name",
]);

/**
 * Build the `tool` spans from a turn's claude_code logs — one per tool
 * invocation, keyed by `tool_use_id`. Filters the tool events out of `records`
 * itself, so it is safe to pass the whole turn's record set; when the set also
 * contains the model api_request_body records, each tool's OUTPUT is recovered
 * from the next model call's transcript (the `tool_result` block keyed by
 * `tool_use_id`), which is the only place claude reports it.
 *
 * The command rides on `langwatch.input` and the recovered result on
 * `langwatch.output`, so the span detail reads like an instrumented call. This
 * is safe because the trace-IO fold skips `span_type=tool`, so a synthesized
 * (parentless) tool span never hijacks the trace's headline I/O.
 */
export function convertClaudeCodeToolLogsToSpans(
  records: ClaudeCodeLogRecordInput[],
): SynthesizedClaudeSpan[] {
  const out: SynthesizedClaudeSpan[] = [];
  for (const traceRecords of groupByTrace(records).values()) {
    out.push(...buildToolSpansForTrace(traceRecords).spans);
  }
  return out;
}

/**
 * The tool spans for a set of records, plus the tool records still awaiting a
 * cross-batch join: a `tool_decision` whose terminal `tool_result` has not
 * landed, and a `tool_result` whose OUTPUT has not been recovered yet (its
 * output rides on a LATER model call's request body, which may be in a future
 * batch).
 */
function buildToolSpansForTrace(
  records: ClaudeCodeLogRecordInput[],
): {
  spans: SynthesizedClaudeSpan[];
  unresolved: ClaudeCodeLogRecordInput[];
} {
  // Recover tool outputs from every model request body in the turn: a later
  // call feeds each tool's result back as a tool_result block keyed by
  // tool_use_id. Merge across bodies (first occurrence wins).
  const toolOutputsByUseId = new Map<string, string>();
  for (const record of records) {
    if (record.eventName !== "api_request_body") continue;
    for (const [useId, text] of collectToolResultsFromRequestBody(
      record.attrs.body,
    )) {
      if (!toolOutputsByUseId.has(useId)) toolOutputsByUseId.set(useId, text);
    }
  }

  // Pair decision + result by tool_use_id. The result is the terminal event and
  // is required to emit a span (it carries name + input + duration); decision
  // only enriches it with the permission-decision provenance.
  const byToolUseId = new Map<
    string,
    {
      decision: ClaudeCodeLogRecordInput | null;
      result: ClaudeCodeLogRecordInput | null;
    }
  >();
  for (const record of [...records].sort(bySequence)) {
    if (
      record.eventName !== "tool_decision" &&
      record.eventName !== "tool_result"
    ) {
      continue;
    }
    const toolUseId = asNonEmpty(record.attrs.tool_use_id);
    if (!toolUseId) continue;
    const entry = byToolUseId.get(toolUseId) ?? {
      decision: null,
      result: null,
    };
    if (record.eventName === "tool_result") entry.result = record;
    else entry.decision = record;
    byToolUseId.set(toolUseId, entry);
  }

  const spans: SynthesizedClaudeSpan[] = [];
  const unresolved: ClaudeCodeLogRecordInput[] = [];
  for (const [toolUseId, { decision, result }] of byToolUseId) {
    const output = toolOutputsByUseId.get(toolUseId) ?? null;
    const span = buildToolSpan(toolUseId, decision, result, output);
    if (span) {
      spans.push(span);
      // The result span still improves if its output has not been recovered:
      // carry the result (and decision) so a future batch's model request body
      // that echoes this tool_result completes the span with its output.
      if (!output) {
        unresolved.push(result!);
        if (decision) unresolved.push(decision);
      }
    } else {
      // A decision with no terminal result yet: carry it until the result lands.
      if (decision) unresolved.push(decision);
    }
  }
  return { spans, unresolved };
}

function buildToolSpan(
  toolUseId: string,
  decision: ClaudeCodeLogRecordInput | null,
  result: ClaudeCodeLogRecordInput | null,
  output: string | null,
): SynthesizedClaudeSpan | null {
  // The result is the terminal event (name + input + duration + success); a
  // decision with no result yet is a tool still running / never run, skipped
  // until the result lands so the span only ever materializes once, complete.
  if (!result) return null;

  const toolName =
    asNonEmpty(result.attrs.tool_name) ??
    asNonEmpty(decision?.attrs.tool_name) ??
    "tool";

  const attrs: OtlpKeyValue[] = [
    strAttr(ATTR_KEYS.SPAN_TYPE, "tool"),
    strAttr(ATTR_KEYS.GEN_AI_OPERATION_NAME, "execute_tool"),
    strAttr(ATTR_KEYS.GEN_AI_TOOL_NAME, toolName),
    strAttr(ATTR_KEYS.GEN_AI_TOOL_CALL_ID, toolUseId),
  ];

  const sessionId =
    asNonEmpty(result.attrs["session.id"]) ??
    asNonEmpty(decision?.attrs["session.id"]);
  if (sessionId) {
    attrs.push(strAttr(ATTR_KEYS.GEN_AI_CONVERSATION_ID, sessionId));
    attrs.push(strAttr(ATTR_KEYS.LANGWATCH_THREAD_ID, sessionId));
  }

  // The tool call arguments (Bash command, Edit patch, …) on langwatch.input.
  const callArguments =
    asNonEmpty(result.attrs.tool_input) ??
    asNonEmpty(decision?.attrs.tool_parameters) ??
    asNonEmpty(result.attrs.tool_parameters);
  if (callArguments) {
    attrs.push(
      strAttr(
        ATTR_KEYS.LANGWATCH_INPUT,
        capPayloadString(callArguments, undefined, "claude_tool_arguments"),
      ),
    );
  }

  // The tool's result recovered from the next model call's transcript. Absent
  // when the tool was the last action in the turn (no later call fed its result
  // back) — left empty rather than fabricated.
  if (output) {
    attrs.push(
      strAttr(
        ATTR_KEYS.LANGWATCH_OUTPUT,
        capPayloadString(output, undefined, "claude_tool_output"),
      ),
    );
  }

  // Every remaining tool attribute (success, duration_ms, decision,
  // *_size_bytes, …) under claude_code.*. Merge decision-then-result so the
  // result's value wins on overlap and no key is emitted twice.
  const merged: Record<string, string> = {
    ...(decision?.attrs ?? {}),
    ...result.attrs,
  };
  for (const [key, value] of Object.entries(merged)) {
    if (CLAUDE_TOOL_HANDLED_ATTRS.has(key)) continue;
    const clean = asNonEmpty(value);
    if (clean) attrs.push(strAttr(`claude_code.${key}`, clean));
  }

  // Timing anchored on the result; completeness nudge so the version WITH the
  // recovered output (which arrives in a later batch than the result) wins the
  // read's max(StartTime) over the earlier output-less version of this span.
  const endMs = result.timeUnixMs;
  const durationMs = asNumber(result.attrs.duration_ms) ?? 0;
  const missingParts = output ? 0 : 1;
  const startMs = Math.max(
    0,
    endMs - durationMs - missingParts * COMPLETENESS_NUDGE_MS,
  );

  // Deterministic id from tool_use_id so decision + result + later output
  // converge on one span (idempotent under re-fold through the stored_spans RMT).
  const spanId = createHash("sha256")
    .update(`${result.traceId}:tool:${toolUseId}`)
    .digest("hex")
    .slice(0, 16);

  return {
    span: makeSpan({
      traceId: result.traceId,
      spanId,
      name: toolName,
      startMs,
      endMs,
      attributes: attrs,
    }),
    resource: result.resource,
    instrumentationScope: result.instrumentationScope,
  };
}
