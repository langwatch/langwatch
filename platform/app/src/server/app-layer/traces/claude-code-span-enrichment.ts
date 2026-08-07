/**
 * Claude Code span content enrichment (PURE core).
 *
 * Claude Code's real OTLP `llm_request` spans carry tokens / model /
 * `request_id` but NO message content — the content lives in separate OTLP LOG
 * records (`api_request_body`, `api_response_body`, `user_prompt`,
 * `assistant_response`). This module joins the two: given a trace's real
 * `llm_request` spans and its content log records, it computes the
 * `input` / `output` {@link SpanInputOutput} to attach to each span so the
 * legacy trace/span API can return whole spans (exports + evals depend on
 * `Span.input` / `Span.output`).
 *
 * Join rules
 * ----------
 * - Output (exact): each `llm_request` span carries the model call's
 *   `request_id`. The matching `api_response_body` / `assistant_response` log
 *   carries the same `request_id`, so output is joined exactly. The assistant
 *   text is pulled with {@link extractAssistantOutputFromResponseBody} (which
 *   keeps `tool_use` markers so a tool-deciding turn still shows what it did),
 *   or taken from the `assistant_response` body directly.
 * - Input (positional): `api_request_body` / `user_prompt` carry NO
 *   `request_id`. A single agent's model calls are sequential, so within one
 *   `query_source` the Nth request body pairs with the Nth span (both in call
 *   order — spans by their given array order, logs by `timeUnixMs`). The parsed
 *   multi-turn messages from {@link buildInputMessagesFromRequestBody} are
 *   preferred; when the request body is absent or truncated (claude caps large
 *   bodies inline, breaking JSON), the `user_prompt` text is the fallback.
 *
 * This function is PURE — no IO, no DB. The caller (TraceService / read path)
 * adapts either a `Span` or a `NormalizedSpan` into the normalized
 * {@link ClaudeSpanRef} / {@link ClaudeContentLog} shapes below, so this core
 * never hardcodes which attribute keys the caller reads. It is idempotent and a
 * no-op (empty map) when there are no claude content logs.
 */
import { capPayloadString } from "~/server/event-sourcing/pipelines/trace-processing/utils/capOversizedLogRecord";
import type { ChatMessage, SpanInputOutput } from "~/server/tracer/types";

import {
  buildInputMessagesFromRequestBody,
  extractAssistantOutputFromResponseBody,
  extractToolResultsFromRequestBody,
  isConversationalQuerySource,
} from "./canonicalisation/extractors/claudeCode";

/** A claude_code content log record, normalized by the caller. */
export interface ClaudeContentLog {
  /** `api_request_body` | `api_response_body` | `user_prompt` | `assistant_response` */
  eventName: string;
  /** The model call's request id — present on `*_response_body` / `assistant_response`, absent on inputs. */
  requestId: string | null;
  /** The agent's query source (e.g. `repl_main_thread`); null on older builds. */
  querySource: string | null;
  /** Log record time; used to order the (request-id-less) input logs. */
  timeUnixMs: number;
  /**
   * For `*_body` events: the Anthropic Messages API request/response JSON.
   * For `user_prompt`: the user-typed prompt text.
   * For `assistant_response`: the assistant reply text.
   */
  body: string | null;
  /**
   * The assistant's reply text, parsed out of the raw response body ONCE at
   * ingest (`deriveLogContentAttributes`) so reads don't re-parse a 60 KB blob.
   * Text only — it carries no `tool_use` markers, hence
   * {@link derivedToolCallCount} below.
   */
  derivedOutputText?: string | null;
  /**
   * How many tools that response asked for, also derived at ingest. When it is
   * greater than zero the derived TEXT alone would lose the tool calls, so the
   * read falls back to the full parse. Zero means the text is the whole reply
   * and the shortcut is safe.
   */
  derivedToolCallCount?: number | null;
}

/** A real `llm_request` span, normalized by the caller. */
export interface ClaudeSpanRef {
  spanId: string;
  /** The span's model-call request id (its `request_id` attribute). */
  requestId: string | null;
  /** The span's query source, when available; may be null. */
  querySource: string | null;
}

/** The content computed for one span. Any field may be null when unmatched. */
export interface ClaudeSpanEnrichment {
  input: SpanInputOutput | null;
  output: SpanInputOutput | null;
}

const INPUT_BODY_EVENT = "api_request_body";
const OUTPUT_BODY_EVENT = "api_response_body";
const USER_PROMPT_EVENT = "user_prompt";
const ASSISTANT_RESPONSE_EVENT = "assistant_response";

/**
 * Grouping key for logs / spans whose `query_source` is null (older claude
 * builds and other emitters don't stamp the field). Null-sourced spans pair
 * only with null-sourced logs, never leaking across a named source's group.
 * The NUL prefix keeps the key uncollidable with any real `query_source`
 * value; it MUST stay written as the `\u0000` escape, never a raw NUL byte,
 * which makes git treat this whole source file as binary (no diffs
 * rendered, grep and lint tooling silently skip it).
 */
const NULL_QUERY_SOURCE_KEY = "\u0000__null_query_source__";

const CHAT_ROLES = [
  "system",
  "user",
  "assistant",
  "function",
  "tool",
  "unknown",
] as const;
type ChatRole = (typeof CHAT_ROLES)[number];
const CHAT_ROLE_SET: ReadonlySet<string> = new Set(CHAT_ROLES);

/**
 * Compute the input/output content to attach to each `llm_request`-style span
 * from the trace's claude_code content logs. Returns a map keyed by `spanId`; a
 * span appears only when it gained input or output, so an unrelated span (or a
 * trace with no claude logs) is left untouched.
 */
export function computeClaudeSpanEnrichment({
  spans,
  logs,
}: {
  spans: ClaudeSpanRef[];
  logs: ClaudeContentLog[];
}): Map<string, ClaudeSpanEnrichment> {
  const result = new Map<string, ClaudeSpanEnrichment>();
  if (spans.length === 0 || logs.length === 0) return result;

  const outputByRequestId = buildOutputIndex(logs);
  const inputBySpanId = buildInputIndex({ spans, logs });

  for (const span of spans) {
    const output =
      span.requestId !== null
        ? (outputByRequestId.get(span.requestId) ?? null)
        : null;
    const input = inputBySpanId.get(span.spanId) ?? null;
    if (input !== null || output !== null) {
      result.set(span.spanId, { input, output });
    }
  }
  return result;
}

/**
 * Index output content by `request_id`. `api_response_body` (parsed) takes
 * precedence over `assistant_response` (raw text) for the same request id, and
 * the first log of each kind wins. Bodies are bounded by `capPayloadString`
 * (the response-body extractor caps internally; the raw text is capped here).
 */
function buildOutputIndex(
  logs: ClaudeContentLog[],
): Map<string, SpanInputOutput> {
  const byRequestId = new Map<string, SpanInputOutput>();

  for (const log of logs) {
    if (log.eventName !== OUTPUT_BODY_EVENT || log.requestId === null) continue;
    if (byRequestId.has(log.requestId)) continue;
    // Ingest parsed the raw body once and stamped the reply text on the record,
    // so prefer that over re-parsing a 60 KB blob on every read. The parse stays
    // as the fallback for records ingested before the derivation existed — and
    // it keeps the `tool_use` markers, which the derived text does not, so we
    // only take the shortcut when the call asked for no tools.
    const derived =
      log.derivedOutputText !== null &&
      log.derivedOutputText !== undefined &&
      (log.derivedToolCallCount ?? 0) === 0
        ? log.derivedOutputText
        : null;
    const text = derived ?? extractAssistantOutputFromResponseBody(log.body);
    if (text !== null) {
      byRequestId.set(log.requestId, { type: "text", value: text });
    }
  }

  for (const log of logs) {
    if (log.eventName !== ASSISTANT_RESPONSE_EVENT || log.requestId === null) {
      continue;
    }
    if (byRequestId.has(log.requestId)) continue;
    if (log.body !== null && log.body.length > 0) {
      byRequestId.set(log.requestId, {
        type: "text",
        value: capPayloadString(log.body, undefined, "assistant_output"),
      });
    }
  }

  return byRequestId;
}

/**
 * Index input content by `spanId` via positional pairing within each
 * `query_source`: the Nth span (call order) pairs with the Nth `api_request_body`
 * (time order). The parsed messages are preferred; a truncated/absent body falls
 * back to the turn's `user_prompt` text.
 *
 * Residual limitation (accepted): the pairing is positional, not id-keyed —
 * `api_request_body` / `user_prompt` carry NO `request_id`, so there is nothing
 * to join on. It holds because ONE agent's model calls are sequential within its
 * `query_source`, so the Nth span and Nth body are the same turn. Two CONCURRENT
 * sub-agents that share a `query_source` (e.g. two parallel Task tools both
 * emitting under `repl_main_thread`) break the invariant: their spans and bodies
 * interleave in one group by time, so span index i can pair with the other
 * agent's body i. Output stays correct (joined exactly by `request_id`); only
 * the input transcript can be mis-attributed. Real Claude Code sub-agents
 * carry distinct `query_source`s (each isolates into its own group above), so
 * this only bites a same-source concurrent emitter — narrow and content-only,
 * hence accepted rather than solved with per-turn correlation.
 */
function buildInputIndex({
  spans,
  logs,
}: {
  spans: ClaudeSpanRef[];
  logs: ClaudeContentLog[];
}): Map<string, SpanInputOutput> {
  const bySpanId = new Map<string, SpanInputOutput>();

  const spansByQuerySource = groupBy(spans, (s) =>
    querySourceKey(s.querySource),
  );
  // Grouping by `query_source` isolates concurrent sources from each other,
  // but it only works while BOTH sides carry the field. Claude Code 2.1.x
  // stamps it on the log events and not on the `llm_request` span, so keying
  // the logs by it puts every body in a group no span can reach, and every
  // model call silently degrades to the bare `user_prompt` text: no history,
  // no system prompt, no tool definitions. When no span declares a source
  // there is nothing to keep apart, so the whole trace pairs as one group.
  const spansDeclareQuerySource = spans.some((s) => s.querySource !== null);
  const requestBodiesByQuerySource = new Map<string, ClaudeContentLog[]>();
  const promptsByQuerySource = new Map<string, ClaudeContentLog[]>();
  for (const log of logs) {
    const key = spansDeclareQuerySource
      ? querySourceKey(log.querySource)
      : NULL_QUERY_SOURCE_KEY;
    if (log.eventName === INPUT_BODY_EVENT) {
      pushInto(requestBodiesByQuerySource, key, log);
    } else if (log.eventName === USER_PROMPT_EVENT) {
      pushInto(promptsByQuerySource, key, log);
    }
  }
  for (const bodies of requestBodiesByQuerySource.values()) {
    bodies.sort(byTimeAsc);
  }
  for (const prompts of promptsByQuerySource.values()) {
    prompts.sort(byTimeAsc);
  }

  for (const [key, spansInGroup] of spansByQuerySource) {
    const requestBodies = requestBodiesByQuerySource.get(key) ?? [];
    const prompts = promptsByQuerySource.get(key) ?? [];
    for (let i = 0; i < spansInGroup.length; i++) {
      const input = buildSpanInput({ requestBody: requestBodies[i], prompts });
      if (input !== null) bySpanId.set(spansInGroup[i]!.spanId, input);
    }
  }

  dedupeRepeatedSystemMessages({ spans, bySpanId });

  return bySpanId;
}

/**
 * Claude re-sends the identical system prompt (and tool definitions) on every
 * call of a session, so a 20-call trace repeats the same 40KB of context 20
 * times in the drawer payload. Keep the full text on the FIRST call that
 * carries each distinct system message (in span order, which the caller feeds
 * time-sorted) and replace later identical copies with a short reference, so
 * the reader still sees on every call THAT the context rode along, without
 * shipping it again.
 */
function dedupeRepeatedSystemMessages({
  spans,
  bySpanId,
}: {
  spans: ClaudeSpanRef[];
  bySpanId: Map<string, SpanInputOutput>;
}): void {
  const firstCallByContent = new Map<string, number>();
  let callNumber = 0;
  for (const span of spans) {
    const input = bySpanId.get(span.spanId);
    if (input?.type !== "chat_messages" || !Array.isArray(input.value)) {
      continue;
    }
    callNumber++;
    const messages = input.value as ChatMessage[];
    for (const [i, message] of messages.entries()) {
      const seenAtCall = firstSystemCall({
        message,
        callNumber,
        firstCallByContent,
      });
      if (seenAtCall === null) continue;
      messages[i] = repeatedSystemPlaceholder(
        message.content as string,
        seenAtCall,
      );
    }
  }
}

/**
 * The earlier call number that already carried this exact system message, or
 * null when the message is not a system string or is being seen for the first
 * time (in which case this call is recorded as its origin).
 */
function firstSystemCall({
  message,
  callNumber,
  firstCallByContent,
}: {
  message: ChatMessage;
  callNumber: number;
  firstCallByContent: Map<string, number>;
}): number | null {
  if (message.role !== "system" || typeof message.content !== "string") {
    return null;
  }
  const firstCall = firstCallByContent.get(message.content);
  if (firstCall === undefined) {
    firstCallByContent.set(message.content, callNumber);
    return null;
  }
  return firstCall;
}

function repeatedSystemPlaceholder(
  content: string,
  firstCall: number,
): ChatMessage {
  const chars = content.length.toLocaleString("en-US");
  return {
    role: "system",
    content: `[system context unchanged since call #${firstCall} of this trace, ${chars} chars not repeated]`,
  };
}

/**
 * The input for one span: the parsed multi-turn messages from its paired
 * `api_request_body`, or the fallback `user_prompt` text when the body is
 * absent/truncated. Each message's content (and the fallback text) is capped.
 */
function buildSpanInput({
  requestBody,
  prompts,
}: {
  requestBody: ClaudeContentLog | undefined;
  prompts: ClaudeContentLog[];
}): SpanInputOutput | null {
  const messages =
    requestBody !== undefined
      ? buildInputMessagesFromRequestBody(requestBody.body)
      : null;
  if (messages !== null && messages.length > 0) {
    const value: ChatMessage[] = messages.map((m) => ({
      role: normalizeRole(m.role),
      content: capPayloadString(m.content, undefined, "input_message"),
    }));
    return { type: "chat_messages", value };
  }

  const promptText = pickPromptFallback({
    prompts,
    refTimeUnixMs: requestBody?.timeUnixMs,
  });
  if (promptText !== null) {
    return {
      type: "text",
      value: capPayloadString(promptText, undefined, "user_prompt"),
    };
  }
  return null;
}

/**
 * Choose the `user_prompt` text to stand in for a truncated/absent request
 * body: the latest non-empty prompt at or before the request body's time (the
 * user turn that triggered this model call), else the earliest non-empty
 * prompt. Null when no prompt carries text.
 */
function pickPromptFallback({
  prompts,
  refTimeUnixMs,
}: {
  prompts: ClaudeContentLog[];
  refTimeUnixMs: number | undefined;
}): string | null {
  const withBody = prompts.filter((p) => p.body !== null && p.body.length > 0);
  if (withBody.length === 0) return null;
  if (refTimeUnixMs !== undefined) {
    let chosen: ClaudeContentLog | null = null;
    for (const p of withBody) {
      if (p.timeUnixMs <= refTimeUnixMs) chosen = p;
    }
    if (chosen !== null) return chosen.body;
  }
  return withBody[0]!.body;
}

function normalizeRole(role: string | undefined): ChatRole {
  return role !== undefined && CHAT_ROLE_SET.has(role)
    ? (role as ChatRole)
    : "unknown";
}

function querySourceKey(querySource: string | null): string {
  return querySource ?? NULL_QUERY_SOURCE_KEY;
}

function byTimeAsc(a: ClaudeContentLog, b: ClaudeContentLog): number {
  return a.timeUnixMs - b.timeUnixMs;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) pushInto(out, key(item), item);
  return out;
}

function pushInto<T>(map: Map<string, T[]>, key: string, item: T): void {
  const existing = map.get(key);
  if (existing !== undefined) existing.push(item);
  else map.set(key, [item]);
}

/** A claude_code tool event log (`tool_decision` / `tool_result`), normalized. */
export interface ClaudeToolLog {
  /** `tool_decision` | `tool_result` */
  eventName: string;
  toolUseId: string | null;
  toolName: string | null;
  /** Claude's derived params JSON (both events). */
  toolParameters: string | null;
  /** The REAL tool input JSON (`tool_result` only). */
  toolInput: string | null;
  /** `tool_decision`'s accept/reject verdict. */
  decision: string | null;
  /** Who decided (`config`, `user_permanent`, ...). */
  decisionSource: string | null;
  /** `tool_result`'s success flag (string "true"/"false" in CH). */
  success: boolean | null;
  durationMs: number | null;
  resultSizeBytes: number | null;
  timeUnixMs: number;
}

/** A tool span (`claude_code.tool` / `.execution`), normalized by the caller. */
export interface ClaudeToolSpanRef {
  spanId: string;
  toolUseId: string;
}

export interface ClaudeToolSpanEnrichment {
  input: SpanInputOutput | null;
  output: SpanInputOutput | null;
}

const TOOL_DECISION_EVENT = "tool_decision";
const TOOL_RESULT_EVENT = "tool_result";

/**
 * Compute input/output for the trace's tool spans from its tool event logs —
 * an EXACT join by `tool_use_id` (both sides carry it), no positional risk.
 *
 * Input: the `tool_result`'s real `tool_input` JSON, else its derived
 * `tool_parameters`, else the `tool_decision`'s parameters.
 *
 * Output: the actual result content when the trace's request bodies carry it
 * (`contentLogs` — see {@link extractToolResultsFromRequestBody}: claude ships
 * tool stdout only as `tool_result` blocks of the NEXT model call's request
 * body). Without bodies (light path), a structured summary of what the
 * telemetry does state: status, success, duration, result size, decision. A
 * rejected tool (decision without a result — it never ran) reports
 * `status: "rejected"`.
 */
export function computeClaudeToolSpanEnrichment({
  spans,
  toolLogs,
  contentLogs,
}: {
  spans: ClaudeToolSpanRef[];
  toolLogs: ClaudeToolLog[];
  contentLogs: ClaudeContentLog[];
}): Map<string, ClaudeToolSpanEnrichment> {
  const result = new Map<string, ClaudeToolSpanEnrichment>();
  if (spans.length === 0 || toolLogs.length === 0) return result;

  // First log per (event, tool_use_id) wins, mirroring buildOutputIndex.
  const resultByUseId = new Map<string, ClaudeToolLog>();
  const decisionByUseId = new Map<string, ClaudeToolLog>();
  for (const log of toolLogs) {
    if (log.toolUseId === null) continue;
    if (
      log.eventName === TOOL_RESULT_EVENT &&
      !resultByUseId.has(log.toolUseId)
    ) {
      resultByUseId.set(log.toolUseId, log);
    } else if (
      log.eventName === TOOL_DECISION_EVENT &&
      !decisionByUseId.has(log.toolUseId)
    ) {
      decisionByUseId.set(log.toolUseId, log);
    }
  }
  if (resultByUseId.size === 0 && decisionByUseId.size === 0) return result;

  const resultContentByUseId = buildToolResultContentIndex(contentLogs);

  for (const span of spans) {
    const toolResult = resultByUseId.get(span.toolUseId) ?? null;
    const decision = decisionByUseId.get(span.toolUseId) ?? null;
    if (toolResult === null && decision === null) continue;

    const input = buildToolInput({ toolResult, decision });
    const output = buildToolOutput({
      toolResult,
      decision,
      resultContent: resultContentByUseId.get(span.toolUseId) ?? null,
    });
    if (input !== null || output !== null) {
      result.set(span.spanId, { input, output });
    }
  }
  return result;
}

/**
 * Harvest every request body's `tool_result` blocks into one
 * `tool_use_id` → content index (first occurrence wins — a tool result is
 * re-sent verbatim in every later turn's rolling history).
 */
function buildToolResultContentIndex(
  contentLogs: ClaudeContentLog[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const log of contentLogs) {
    if (log.eventName !== INPUT_BODY_EVENT || log.body === null) continue;
    for (const [useId, text] of extractToolResultsFromRequestBody(log.body)) {
      if (!out.has(useId)) out.set(useId, text);
    }
  }
  return out;
}

function buildToolInput({
  toolResult,
  decision,
}: {
  toolResult: ClaudeToolLog | null;
  decision: ClaudeToolLog | null;
}): SpanInputOutput | null {
  const raw =
    toolResult?.toolInput ??
    toolResult?.toolParameters ??
    decision?.toolParameters ??
    null;
  if (raw === null || raw.length === 0) return null;
  return toJsonOrText(capPayloadString(raw, undefined, "tool_input"));
}

function buildToolOutput({
  toolResult,
  decision,
  resultContent,
}: {
  toolResult: ClaudeToolLog | null;
  decision: ClaudeToolLog | null;
  resultContent: string | null;
}): SpanInputOutput | null {
  if (resultContent !== null) {
    return { type: "text", value: resultContent };
  }
  if (toolResult !== null) {
    const status =
      toolResult.success === false
        ? "failed"
        : toolResult.success === true
          ? "completed"
          : "unknown";
    return {
      type: "json",
      value: prune({
        // The telemetry states sizes and outcome, not content — this summary
        // IS the output on the light path, not a fallback for a parse miss.
        status,
        success: toolResult.success,
        durationMs: toolResult.durationMs,
        resultSizeBytes: toolResult.resultSizeBytes,
        decision: decision?.decision ?? null,
        decisionSource: decision?.decisionSource ?? toolResult.decisionSource,
      }),
    };
  }
  if (decision !== null && decision.decision === "reject") {
    // Denied tools never run: no result log ever comes.
    return {
      type: "json",
      value: prune({
        status: "rejected",
        decision: decision.decision,
        decisionSource: decision.decisionSource,
      }),
    };
  }
  return null;
}

/** Parse-or-text: valid JSON becomes a `json` payload, anything else `text`. */
function toJsonOrText(value: string): SpanInputOutput {
  try {
    return { type: "json", value: JSON.parse(value) as object };
  } catch {
    return { type: "text", value };
  }
}

function prune<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * The interaction (turn) span's OUTPUT: the last conversational assistant
 * reply that falls inside the turn's window (+`slackMs` for the exporter
 * flushing the reply just after the span closes). `api_response_body` beats
 * `assistant_response` at the same timestamp (parsed body keeps `tool_use`
 * markers); both are gated on {@link isConversationalQuerySource} so a
 * utility reply (title generation, autosuggest) can never headline the turn.
 */
export function computeClaudeInteractionOutput({
  logs,
  windowStartMs,
  windowEndMs,
  slackMs = 2_000,
}: {
  logs: ClaudeContentLog[];
  windowStartMs: number;
  windowEndMs: number;
  slackMs?: number;
}): SpanInputOutput | null {
  let best: { timeUnixMs: number; rank: number; text: string } | null = null;
  for (const log of logs) {
    if (!isConversationalQuerySource(log.querySource)) continue;
    if (log.timeUnixMs < windowStartMs) continue;
    if (log.timeUnixMs > windowEndMs + slackMs) continue;

    let text: string | null = null;
    let rank = 0;
    if (log.eventName === OUTPUT_BODY_EVENT) {
      const derived =
        log.derivedOutputText != null && (log.derivedToolCallCount ?? 0) === 0
          ? log.derivedOutputText
          : null;
      text = derived ?? extractAssistantOutputFromResponseBody(log.body);
      rank = 1;
    } else if (log.eventName === ASSISTANT_RESPONSE_EVENT) {
      text =
        log.body !== null && log.body.length > 0
          ? capPayloadString(log.body, undefined, "assistant_output")
          : null;
      rank = 0;
    } else {
      continue;
    }
    if (text === null) continue;
    if (
      best === null ||
      log.timeUnixMs > best.timeUnixMs ||
      (log.timeUnixMs === best.timeUnixMs && rank > best.rank)
    ) {
      best = { timeUnixMs: log.timeUnixMs, rank, text };
    }
  }
  return best !== null ? { type: "text", value: best.text } : null;
}
