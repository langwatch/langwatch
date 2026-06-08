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
 * (`traceId = sha256(session.id:prompt.id)`), so a turn's log set is small and
 * bounded and every batch is already visible when it is folded.
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
 * Cost is handled by the existing span pipeline. Anthropic models are on the
 * static price table (computeSpanCost priority 2); we also set
 * `langwatch.span.cost = cost_usd` (reserved fallback, priority 3) so an
 * off-table claude model is still costed from Anthropic's own figure.
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
  isConversationalQuerySource,
} from "./canonicalisation/extractors/claudeCode";

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
 */
export function convertClaudeCodeTurnToSpans(
  records: ClaudeCodeLogRecordInput[],
  promptTextById: ReadonlyMap<string, string> = new Map(),
): SynthesizedClaudeSpan[] {
  const out: SynthesizedClaudeSpan[] = [];
  for (const traceRecords of groupByTrace(records).values()) {
    out.push(...buildTurnSpans(traceRecords, promptTextById));
  }
  return out;
}

function buildTurnSpans(
  records: ClaudeCodeLogRecordInput[],
  promptTextById: ReadonlyMap<string, string>,
): SynthesizedClaudeSpan[] {
  const traceId = records[0]?.traceId;
  if (!traceId) return [];

  // Deterministic per-turn root id so every re-fold parents children identically.
  const rootSpanId = createHash("sha256")
    .update(`${traceId}:claude_root`)
    .digest("hex")
    .slice(0, 16);

  const children = [
    ...buildModelSpansForTrace(records, promptTextById),
    ...buildToolSpansForTrace(records),
  ];
  for (const child of children) {
    child.span.parentSpanId = rootSpanId;
  }

  if (children.length === 0) return [];

  const root = buildRootSpan({
    records,
    traceId,
    rootSpanId,
    children,
    promptTextById,
  });
  return [root, ...children];
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
    out.push(...buildModelSpansForTrace(traceRecords, promptTextById));
  }
  return out;
}

function buildModelSpansForTrace(
  records: ClaudeCodeLogRecordInput[],
  promptTextById: ReadonlyMap<string, string>,
): SynthesizedClaudeSpan[] {
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
  }

  // A request/response body with no anchor in the set is NOT emitted on its own
  // — it pairs with its anchor once that anchor is in the folded turn. This is
  // what removes the cross-batch orphan-body duplicate by construction.
  return spans;
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

  // Reserved fallback cost key (priority 3 in computeSpanCost). For Anthropic
  // models the static table (priority 2) wins; this covers off-table models.
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
 * The turn ROOT span: the user_prompt becomes one parentless span per turn that
 * carries the turn input, with the model + tool spans hanging under it. A single
 * root replaces the old flat fan of parentless model spans, so the trace has a
 * real shape and the input/output gates in the fold work off one root. Its
 * timing envelopes its children (and the user_prompt event). The SpanId is a
 * stable hash of the trace, so every re-fold produces the same root.
 */
function buildRootSpan({
  records,
  traceId,
  rootSpanId,
  children,
  promptTextById,
}: {
  records: ClaudeCodeLogRecordInput[];
  traceId: string;
  rootSpanId: string;
  children: SynthesizedClaudeSpan[];
  promptTextById: ReadonlyMap<string, string>;
}): SynthesizedClaudeSpan {
  const userPrompt =
    records.find((r) => r.eventName === "user_prompt") ?? null;
  const promptText =
    asNonEmpty(userPrompt?.attrs.prompt) ??
    asNonEmpty([...promptTextById.values()][0]);

  const sessionId =
    asNonEmpty(userPrompt?.attrs["session.id"]) ??
    asNonEmpty(records.find((r) => r.attrs["session.id"])?.attrs["session.id"]);

  const attrs: OtlpKeyValue[] = [strAttr(ATTR_KEYS.SPAN_TYPE, "agent")];
  if (sessionId) {
    attrs.push(strAttr(ATTR_KEYS.GEN_AI_CONVERSATION_ID, sessionId));
    attrs.push(strAttr(ATTR_KEYS.LANGWATCH_THREAD_ID, sessionId));
  }
  if (promptText) {
    attrs.push(
      strAttr(
        ATTR_KEYS.LANGWATCH_INPUT,
        capPayloadString(promptText, undefined, "claude_input"),
      ),
    );
  }
  // user_prompt provenance (command_name, command_source, prompt_length, …).
  if (userPrompt) {
    for (const [key, value] of Object.entries(userPrompt.attrs)) {
      if (CLAUDE_ROOT_HANDLED_ATTRS.has(key)) continue;
      const clean = asNonEmpty(value);
      if (clean) attrs.push(strAttr(`claude_code.${key}`, clean));
    }
  }

  // Envelope the children (and the user_prompt event) in time.
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  for (const child of children) {
    startMs = Math.min(startMs, nanoToMs(child.span.startTimeUnixNano));
    endMs = Math.max(endMs, nanoToMs(child.span.endTimeUnixNano));
  }
  if (userPrompt) {
    startMs = Math.min(startMs, userPrompt.timeUnixMs);
    endMs = Math.max(endMs, userPrompt.timeUnixMs);
  }
  if (!Number.isFinite(startMs)) startMs = userPrompt?.timeUnixMs ?? 0;
  if (!Number.isFinite(endMs)) endMs = startMs;

  const name = rootSpanName(promptText);
  const resource =
    userPrompt?.resource ?? children[0]?.resource ?? null;
  const instrumentationScope =
    userPrompt?.instrumentationScope ??
    children[0]?.instrumentationScope ??
    null;

  return {
    span: makeSpan({
      traceId,
      spanId: rootSpanId,
      name,
      startMs,
      endMs,
      attributes: attrs,
      kind: "SPAN_KIND_SERVER",
    }),
    resource,
    instrumentationScope,
  };
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
    out.push(...buildToolSpansForTrace(traceRecords));
  }
  return out;
}

function buildToolSpansForTrace(
  records: ClaudeCodeLogRecordInput[],
): SynthesizedClaudeSpan[] {
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
  for (const [toolUseId, { decision, result }] of byToolUseId) {
    const span = buildToolSpan(
      toolUseId,
      decision,
      result,
      toolOutputsByUseId.get(toolUseId) ?? null,
    );
    if (span) spans.push(span);
  }
  return spans;
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
