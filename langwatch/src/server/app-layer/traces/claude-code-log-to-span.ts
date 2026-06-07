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
 * The claude_code tool events (tool_decision / tool_result) are trapped too
 * and converted into `tool` spans (one per tool_use_id) by
 * convertClaudeCodeToolLogsToSpans, so the agent's Bash / Edit / Read calls
 * show up as waterfall nodes. Every OTHER claude_code event (user_prompt,
 * hook_*, mcp_server_connection, plugin_loaded, any unknown event.name) stays
 * on the normal log path, untouched — see CLAUDE_CODE_CONVERTIBLE_EVENTS /
 * CLAUDE_CODE_TOOL_EVENTS.
 *
 * Join determinism (verified against real OTLP):
 *   - OUTPUT: api_request <-> api_response_body by exact request_id (both carry
 *             it). Both are logged at call END, so they co-batch and join.
 *   - INPUT:  api_request <-> api_request_body by (model, query_source)
 *             consume-once in time order — api_request_body has NO request_id on
 *             the wire, and query_source is part of the key so a
 *             generate_session_title body never cross-pairs with a
 *             repl_main_thread request.
 *
 * Cost: handled entirely by the existing span pipeline. Anthropic models are on
 * our static price table, so computeSpanCost prices the span from tokens
 * (priority 2). We additionally set `langwatch.span.cost = cost_usd`, the
 * existing reserved fallback key (priority 3), so a future claude model not yet
 * on the table is still costed from Anthropic's own figure. No pipeline change.
 *
 * Cross-batch split: api_request_body is logged at call START, the api_request
 * anchor + api_response_body at call END. For any call longer than the OTLP
 * export interval (every tool-using turn) the body lands in a different export
 * batch than its anchor, and with no request_id it can't be re-paired across
 * batches. An orphan body is therefore DROPPED rather than emitted as a
 * duplicate, input-less span: the turn's input is already on the trace via the
 * co-batched user_prompt event, and the tool spans show what the call did.
 * Anchor + response co-batch (both at call END), so the output stays joined; a
 * rare orphan response still becomes its own marked span (claude_code.orphan)
 * rather than lose the reply. Restoring per-span input on cross-batch-split
 * calls would need a stateful join buffer — a tracked follow-up, deliberately
 * not new receiver-side Redis state.
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

/**
 * The two claude_code log events that describe one tool invocation and are
 * trapped+converted into a single `tool` span: `tool_decision` (the moment
 * claude chose to run a tool — permission decision + source) and
 * `tool_result` (the terminal event carrying tool name, input, duration, and
 * success). Without this the Bash/Edit/Read calls a coding turn makes never
 * appear as waterfall nodes — the trace shows the model spans but not what
 * the agent actually DID, which is most of the value of an agent trace.
 *
 * Paired by `tool_use_id` (both carry it). The tool_result alone is enough to
 * build a complete span; tool_decision only enriches it with the
 * permission-decision provenance, so a cross-batch split that separates the
 * two still yields a usable tool span.
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

  // Orphan api_request_body (cross-batch split): claude logs the request body
  // at call START and the api_request anchor at call END, so for any call
  // longer than the OTLP export interval (every tool-using turn) the body and
  // anchor land in different batches and the body can't pair — it carries no
  // request_id to converge on. Emitting it as its own span produced a
  // confusing DUPLICATE of the model call (input but no tokens/cost/output)
  // that also sorted before the anchor in the waterfall ("output earlier than
  // input"). Drop it: the turn's input is already on the trace via the
  // co-batched `user_prompt` event, and the tool spans show what the call did.
  // (Restoring per-span input on cross-batch-split calls needs a stateful join
  // buffer — a tracked follow-up, deliberately not new receiver-side state.)

  // Orphan api_response_body: the response is logged at call END alongside the
  // anchor, so it rarely splits; when it does it still carries the assistant's
  // reply, so emit it as its own marked span rather than lose the output.
  responses.forEach((response, i) => {
    if (!usedResponses.has(i)) spans.push(buildOrphanResponseSpan(response));
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

/**
 * The span's waterfall name. Conversational turns are named by model (matching
 * the gateway / Path A convention). Non-conversational utility calls
 * (generate_session_title, prompt_suggestion, …) are named by their
 * query_source instead: a turn fans out into the main reply PLUS a couple of
 * these housekeeping calls, and naming all of them "claude-opus-4-8" left the
 * waterfall with mysterious-looking model spans that carry no conversation. The
 * query_source name says what the call was FOR.
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

  // OUTPUT text from the response body — attached to EVERY model call,
  // conversational or utility (generate_session_title / prompt_suggestion), so
  // drilling into a utility span shows what the model actually returned. The
  // trace-level headline output stays gated to conversation turns in
  // trace-io-accumulation.service.ts (claude utility spans are skipped there,
  // like tool spans), so a utility reply never becomes the trace's output.
  if (response) {
    const outputText = extractAssistantTextFromResponseBody(response.attrs.body);
    if (outputText) {
      attrs.push(strAttr(ATTR_KEYS.GEN_AI_COMPLETION, outputText));
    }
  }

  const durationMs = asNumber(anchor.attrs.duration_ms) ?? 0;
  const endMs = anchor.timeUnixMs;
  const startMs = Math.max(0, endMs - durationMs);

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

/**
 * Build a marked span for an orphan api_response_body — a response whose
 * api_request anchor landed in a different export batch. Rare, because the
 * response and anchor are both logged at call END and so co-batch; when it
 * does split, the response still carries the assistant's reply, so it becomes
 * its own span rather than losing the output. The `claude_code.orphan` marker
 * distinguishes it from a fully-joined call.
 */
function buildOrphanResponseSpan(
  record: ClaudeCodeLogRecordInput,
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

  const querySource = asNonEmpty(record.attrs.query_source);
  // Output on every model call (see buildCollapsedSpan); the trace headline
  // stays conversational-only via the fold's accumulation gate.
  const outputText = extractAssistantTextFromResponseBody(record.attrs.body);
  if (outputText) {
    attrs.push(strAttr(ATTR_KEYS.GEN_AI_COMPLETION, outputText));
  }

  // No api_request to anchor timing on: zero-duration at the record's own time.
  return {
    span: makeSpan({
      traceId: record.traceId,
      spanId: record.spanId,
      name: claudeSpanName(model, querySource),
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
 * Convert claude_code tool events (tool_decision + tool_result) into `tool`
 * spans — one per tool invocation, keyed by `tool_use_id`. Without these the
 * waterfall shows the model calls but never the Bash / Edit / Read invocations
 * the agent actually ran, which is most of the value of an agent trace. See
 * CLAUDE_CODE_TOOL_EVENTS.
 *
 * The command lands on `langwatch.input` so the span detail reads like an
 * instrumented function call (args in). This is safe because the trace-IO fold
 * skips `span_type=tool` (see trace-io-accumulation.service.ts): a synthesized
 * claude span is parentless (a "root" to the fold), so without that skip its
 * input would hijack the trace's headline input. Only `gen_ai.tool.name` and
 * `gen_ai.tool.call.id` (real OTel gen_ai attributes) are mapped from the raw
 * claude keys; everything else is copied verbatim under `claude_code.*`. There
 * is no output to mirror - claude reports only the result SIZE
 * (`tool_result_size_bytes`), never the tool's stdout.
 */
export function convertClaudeCodeToolLogsToSpans(
  records: ClaudeCodeLogRecordInput[],
): SynthesizedClaudeSpan[] {
  const byTrace = new Map<string, ClaudeCodeLogRecordInput[]>();
  for (const record of records) {
    const list = byTrace.get(record.traceId);
    if (list) list.push(record);
    else byTrace.set(record.traceId, [record]);
  }

  const out: SynthesizedClaudeSpan[] = [];
  for (const traceRecords of byTrace.values()) {
    // Pair decision + result by tool_use_id. Either may be absent on a
    // cross-batch split; tool_result alone is enough for a complete span.
    const byToolUseId = new Map<
      string,
      {
        decision: ClaudeCodeLogRecordInput | null;
        result: ClaudeCodeLogRecordInput | null;
      }
    >();
    for (const record of [...traceRecords].sort(bySequence)) {
      const toolUseId = asNonEmpty(record.attrs.tool_use_id);
      if (!toolUseId) continue;
      const entry = byToolUseId.get(toolUseId) ?? {
        decision: null,
        result: null,
      };
      if (record.eventName === "tool_result") entry.result = record;
      else if (record.eventName === "tool_decision") entry.decision = record;
      byToolUseId.set(toolUseId, entry);
    }

    for (const [toolUseId, { decision, result }] of byToolUseId) {
      const span = buildToolSpan(toolUseId, decision, result);
      if (span) out.push(span);
    }
  }
  return out;
}

function buildToolSpan(
  toolUseId: string,
  decision: ClaudeCodeLogRecordInput | null,
  result: ClaudeCodeLogRecordInput | null,
): SynthesizedClaudeSpan | null {
  // tool_result is the terminal event and carries name + input + duration +
  // success, so it's the primary; tool_decision only enriches with the
  // permission-decision provenance.
  const primary = result ?? decision;
  if (!primary) return null;

  const toolName =
    asNonEmpty(result?.attrs.tool_name) ??
    asNonEmpty(decision?.attrs.tool_name) ??
    "tool";

  const attrs: OtlpKeyValue[] = [
    strAttr(ATTR_KEYS.SPAN_TYPE, "tool"),
    strAttr(ATTR_KEYS.GEN_AI_OPERATION_NAME, "execute_tool"),
    strAttr(ATTR_KEYS.GEN_AI_TOOL_NAME, toolName),
    strAttr(ATTR_KEYS.GEN_AI_TOOL_CALL_ID, toolUseId),
  ];

  const sessionId =
    asNonEmpty(result?.attrs["session.id"]) ??
    asNonEmpty(decision?.attrs["session.id"]);
  if (sessionId) {
    attrs.push(strAttr(ATTR_KEYS.GEN_AI_CONVERSATION_ID, sessionId));
    attrs.push(strAttr(ATTR_KEYS.LANGWATCH_THREAD_ID, sessionId));
  }

  // The tool call arguments (Bash command, Edit patch, ...). tool_input on
  // tool_result is the clean call; tool_parameters is the fallback. Surface it
  // as the span's `langwatch.input` so the detail panel reads like an
  // instrumented function call (args in) instead of an empty I/O, rather than
  // `gen_ai.tool.call.arguments` (not a real OTel attribute). The trace-IO
  // fold skips `tool` spans, so this no longer hijacks the trace's headline
  // input. There is no matching output: claude only reports the result SIZE
  // (tool_result_size_bytes), never the tool's stdout, so we leave output
  // empty rather than invent one.
  const callArguments =
    asNonEmpty(result?.attrs.tool_input) ??
    asNonEmpty(decision?.attrs.tool_parameters) ??
    asNonEmpty(result?.attrs.tool_parameters);
  if (callArguments) {
    attrs.push(
      strAttr(
        ATTR_KEYS.LANGWATCH_INPUT,
        capPayloadString(callArguments, undefined, "claude_tool_arguments"),
      ),
    );
  }

  // Every remaining tool attribute (success, duration_ms, decision,
  // *_size_bytes, …) under claude_code.*. Merge decision-then-result so the
  // result's value wins on overlap and no key is emitted twice.
  const merged: Record<string, string> = {
    ...(decision?.attrs ?? {}),
    ...(result?.attrs ?? {}),
  };
  for (const [key, value] of Object.entries(merged)) {
    if (CLAUDE_TOOL_HANDLED_ATTRS.has(key)) continue;
    const clean = asNonEmpty(value);
    if (clean) attrs.push(strAttr(`claude_code.${key}`, clean));
  }

  // Timing: tool_result.duration_ms anchored at the result time; without a
  // result, the decision time (zero-duration).
  const endMs = primary.timeUnixMs;
  const durationMs = asNumber(result?.attrs.duration_ms) ?? 0;
  const startMs = result
    ? Math.max(0, endMs - durationMs)
    : (decision?.timeUnixMs ?? endMs);

  // Deterministic id from tool_use_id so decision + result converge on one
  // span (idempotent under re-ingest through the stored_spans RMT).
  const spanId = createHash("sha256")
    .update(`${primary.traceId}:tool:${toolUseId}`)
    .digest("hex")
    .slice(0, 16);

  return {
    span: makeSpan({
      traceId: primary.traceId,
      spanId,
      name: toolName,
      startMs,
      endMs,
      attributes: attrs,
    }),
    resource: primary.resource,
    instrumentationScope: primary.instrumentationScope,
  };
}
