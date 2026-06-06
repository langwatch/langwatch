/**
 * Claude Code log-record → gen_ai span converter (write-path).
 *
 * Claude Code 2.x emits its model calls as OTLP LOG records, not spans
 * (scope `com.anthropic.claude_code.events`). Three of those log events
 * describe one model call and are "trapped" at ingest and CONVERTED into a
 * single standard OTel gen_ai.* span:
 *
 *   - api_request        anchor: model, input/output/cache tokens, cost_usd,
 *                        duration_ms, request_id, query_source, session.id
 *   - api_request_body   the request payload (messages[]) -> gen_ai.prompt
 *   - api_response_body   the response payload (content[].text) -> gen_ai.completion
 *
 * The three collapse into ONE `llm` span keyed by the api_request log's own
 * (synthesized) SpanId, so the existing span pipeline + canonicalisation +
 * fold lift model / tokens / cost / input / output for free — no read-path
 * code, no new fold-state fields. The converted log records are NOT written
 * to stored_log_records (no double-write, no double-count): the span is the
 * single source of truth.
 *
 * Every OTHER claude_code event (user_prompt, hook_*, mcp_server_connection,
 * plugin_loaded, any unknown event.name) stays on the normal log path,
 * untouched — see CLAUDE_CODE_CONVERTIBLE_EVENTS.
 *
 * Join determinism (both keys verified against real OTLP on 2026-06-05):
 *   - OUTPUT: api_request <-> api_response_body by exact request_id (both carry it).
 *   - INPUT:  api_request <-> api_request_body by (model, query_source) consume-once
 *             in time order — api_request_body has NO request_id on the wire, and
 *             query_source is part of the key so a generate_session_title body can
 *             never cross-pair with a repl_main_thread request.
 *
 * Cost: handled entirely by the existing span pipeline. Anthropic models are on
 * our static price table, so computeSpanCost prices the span from tokens
 * (priority 2). We additionally set `langwatch.span.cost = cost_usd`, the
 * existing reserved fallback key (priority 3), so a future claude model not yet
 * on the table is still costed from Anthropic's own figure. No pipeline change.
 *
 * Known v1 limitation (cross-batch): claude logs the three events synchronously
 * post-response, so they co-batch and join in-request. A retry/network reorder
 * that splits the triplet across OTLP export batches yields orphan parts; each
 * orphan still becomes its own gen_ai span (marked `claude_code.orphan=true`) so
 * nothing is silently dropped — it just isn't collapsed into one span for that
 * turn. Cross-batch dedup is a tracked follow-up, not a silent loss.
 */

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
  extractAssistantTextFromResponseBody,
  isConversationalQuerySource,
} from "./canonicalisation/extractors/claudeCode";

export const CLAUDE_CODE_EVENT_SCOPE = "com.anthropic.claude_code.events";

/**
 * The three claude_code log events that describe one model call and are
 * trapped+converted into a single gen_ai span (and dropped from the log
 * path). Everything else under the claude_code scope stays a log.
 */
export const CLAUDE_CODE_CONVERTIBLE_EVENTS: ReadonlySet<string> = new Set([
  "api_request",
  "api_request_body",
  "api_response_body",
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

/** A buffered claude_code log record pulled out of the log path for conversion. */
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

/**
 * Convert a batch of trapped claude_code log records into gen_ai spans.
 * Records are grouped by traceId, the triplet is joined per the determinism
 * rules above, and any orphan part still becomes its own (marked) span.
 *
 * `promptTextById` maps a `prompt.id` to the clean user-typed text from the
 * co-batched `user_prompt` event (which stays on the log path, so it is passed
 * in rather than found among `records`). claude-code truncates large
 * `api_request_body` payloads inline (`body_truncated=true`, ~64KB), which makes
 * the body unparseable — without this the span input would fall back to the raw
 * truncated JSON blob. The clean user_prompt text is the genuine turn input.
 */
export function convertClaudeCodeLogsToSpans(
  records: ClaudeCodeLogRecordInput[],
  promptTextById: ReadonlyMap<string, string> = new Map(),
): SynthesizedClaudeSpan[] {
  const byTrace = new Map<string, ClaudeCodeLogRecordInput[]>();
  for (const record of records) {
    const list = byTrace.get(record.traceId);
    if (list) list.push(record);
    else byTrace.set(record.traceId, [record]);
  }

  const out: SynthesizedClaudeSpan[] = [];
  for (const traceRecords of byTrace.values()) {
    out.push(...convertOneTrace(traceRecords, promptTextById));
  }
  return out;
}

const bySequence = (
  a: ClaudeCodeLogRecordInput,
  b: ClaudeCodeLogRecordInput,
): number => {
  if (a.timeUnixMs !== b.timeUnixMs) return a.timeUnixMs - b.timeUnixMs;
  const sa = asNumber(a.attrs["event.sequence"]) ?? 0;
  const sb = asNumber(b.attrs["event.sequence"]) ?? 0;
  return sa - sb;
};

function convertOneTrace(
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
    // OUTPUT join: exact request_id match (consume-once).
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

    // INPUT join: (model, query_source) consume-once in time order.
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

    spans.push(buildCollapsedSpan(anchor, body, response, promptTextById));
  }

  // Orphans (cross-batch split): emit each remaining part as its own marked
  // span so no converted content is silently dropped.
  bodies.forEach((body, i) => {
    if (!usedBodies.has(i)) spans.push(buildOrphanSpan(body, promptTextById));
  });
  responses.forEach((response, i) => {
    if (!usedResponses.has(i)) spans.push(buildOrphanSpan(response, promptTextById));
  });

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
 * clean co-batched `user_prompt` text as the single latest turn. The raw
 * truncated JSON blob is NEVER used as input — wrapping it as one user message
 * is what made the trace detail render `{"model":...,"messages":[...]}` instead
 * of a conversation. Each message's content is capped individually so the array
 * stays valid JSON. Returns null when nothing usable is available.
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

function buildCollapsedSpan(
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

  // INPUT as a structured `gen_ai.input.messages` conversation parsed from the
  // request body (system + every turn). When claude truncated the body inline,
  // resolveInputMessages falls back to the clean user_prompt text as the latest
  // turn — never the raw JSON blob.
  if (body) {
    const inputMessages = resolveInputMessages(body, promptTextById);
    if (inputMessages) {
      attrs.push(strAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, inputMessages));
    }
  }

  // OUTPUT text from the response body, gated on a genuine conversation turn so
  // utility calls (generate_session_title / prompt_suggestion) never surface as
  // the assistant's reply. The token/cost usage still folds for those calls.
  if (response) {
    const querySource = asNonEmpty(response.attrs.query_source);
    if (isConversationalQuerySource(querySource)) {
      const outputText = extractAssistantTextFromResponseBody(
        response.attrs.body,
      );
      if (outputText) {
        attrs.push(strAttr(ATTR_KEYS.GEN_AI_COMPLETION, outputText));
      }
    }
  }

  const durationMs = asNumber(anchor.attrs.duration_ms) ?? 0;
  const endMs = anchor.timeUnixMs;
  const startMs = Math.max(0, endMs - durationMs);

  return {
    span: makeSpan({
      traceId: anchor.traceId,
      spanId: anchor.spanId,
      name: model ?? "llm",
      startMs,
      endMs,
      attributes: attrs,
    }),
    resource: anchor.resource,
    instrumentationScope: anchor.instrumentationScope,
  };
}

function buildOrphanSpan(
  record: ClaudeCodeLogRecordInput,
  promptTextById: ReadonlyMap<string, string>,
): SynthesizedClaudeSpan {
  const attrs = baseAttrs(record);
  attrs.push(boolAttr("claude_code.orphan", true));
  attrs.push(strAttr("claude_code.orphan_kind", record.eventName));

  const model = asNonEmpty(record.attrs.model);
  if (model) {
    attrs.push(strAttr(ATTR_KEYS.GEN_AI_REQUEST_MODEL, model));
    attrs.push(strAttr(ATTR_KEYS.GEN_AI_RESPONSE_MODEL, model));
  }

  appendProvenanceAttrs(attrs, record);

  if (record.eventName === "api_request_body") {
    const inputMessages = resolveInputMessages(record, promptTextById);
    if (inputMessages) {
      attrs.push(strAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, inputMessages));
    }
  } else if (record.eventName === "api_response_body") {
    const querySource = asNonEmpty(record.attrs.query_source);
    if (isConversationalQuerySource(querySource)) {
      const outputText = extractAssistantTextFromResponseBody(
        record.attrs.body,
      );
      if (outputText) {
        attrs.push(strAttr(ATTR_KEYS.GEN_AI_COMPLETION, outputText));
      }
    }
  }

  // No api_request to anchor timing on: zero-duration at the record's own time.
  return {
    span: makeSpan({
      traceId: record.traceId,
      spanId: record.spanId,
      name: model ?? "llm",
      startMs: record.timeUnixMs,
      endMs: record.timeUnixMs,
      attributes: attrs,
    }),
    resource: record.resource,
    instrumentationScope: record.instrumentationScope,
  };
}

function makeSpan({
  traceId,
  spanId,
  name,
  startMs,
  endMs,
  attributes,
}: {
  traceId: string;
  spanId: string;
  name: string;
  startMs: number;
  endMs: number;
  attributes: OtlpKeyValue[];
}): OtlpSpan {
  return {
    traceId,
    spanId,
    parentSpanId: null,
    name,
    kind: SPAN_KIND_CLIENT,
    startTimeUnixNano: msToUnixNano(startMs),
    endTimeUnixNano: msToUnixNano(endMs),
    attributes,
    events: [],
    links: [],
    status: { message: null, code: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}
