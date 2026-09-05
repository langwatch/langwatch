/**
 * The message half of the Claude Code join: the shapes a content log and a model-call span arrive
 * in, and the indexes that pair them. Output is keyed exactly by request id; input is paired
 * positionally within one query source, since neither a request body nor a prompt carries one.
 */

import type {
  ChatMessage,
  SpanInputOutput,
  TraceCanonicalisationService,
} from "@langwatch/trace-contract";
import { capPayloadString } from "./trace-payload-cap.rules";

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
   * Assistant's reply text, parsed out of the raw response body once at ingest so reads never
   * re-parse a 60 KB blob. Text only, with no tool_use markers, hence
   * {@link derivedToolCallCount} below.
   */
  derivedOutputText?: string | null;
  /**
   * How many tools that response asked for, also derived at ingest. Above zero, the derived text
   * alone would lose the tool calls and the read falls back to the full parse; at zero the text is
   * the whole reply and the shortcut is safe.
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

export const INPUT_BODY_EVENT = "api_request_body";
export const OUTPUT_BODY_EVENT = "api_response_body";
export const USER_PROMPT_EVENT = "user_prompt";
export const ASSISTANT_RESPONSE_EVENT = "assistant_response";

/**
 * Grouping key for logs and spans whose query_source is null, older builds and other emitters not
 * stamping it. Null-sourced spans pair only with null-sourced logs. The NUL prefix keeps the key
 * uncollidable, and must stay written as an escape: a raw NUL byte makes git treat this as binary.
 */
const NULL_QUERY_SOURCE_KEY = "\u0000__null_query_source__";

const CHAT_ROLES = ["system", "user", "assistant", "function", "tool", "unknown"] as const;
type ChatRole = (typeof CHAT_ROLES)[number];
const CHAT_ROLE_SET: ReadonlySet<string> = new Set(CHAT_ROLES);

/**
 * Indexes output content by request_id. A parsed response body takes precedence over raw assistant
 * text for the same id, and the first log of each kind wins. Bodies are bounded: the response-body
 * extractor caps internally, and raw text is capped here.
 */
export function buildOutputIndex(
  logs: ClaudeContentLog[],
  traceCanonicalisation: TraceCanonicalisationService,
): Map<string, SpanInputOutput> {
  const byRequestId = new Map<string, SpanInputOutput>();

  for (const log of logs) {
    if (log.eventName !== OUTPUT_BODY_EVENT || log.requestId === null) {
      continue;
    }

    if (byRequestId.has(log.requestId)) {
      continue;
    }

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
    const text =
      derived ??
      traceCanonicalisation.deriveClaudeResponseContent({
        body: log.body,
      }).assistantOutput;
    if (text !== null) {
      byRequestId.set(log.requestId, { type: "text", value: text });
    }
  }

  for (const log of logs) {
    if (log.eventName !== ASSISTANT_RESPONSE_EVENT || log.requestId === null) {
      continue;
    }

    if (byRequestId.has(log.requestId)) {
      continue;
    }

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
 * Indexes input content by spanId, pairing positionally within each query source: the Nth span in
 * call order takes the Nth request body in time order. Neither side carries a request_id, so two
 * concurrent sub-agents sharing one query source can mis-attribute input; output stays exact.
 */
export function buildInputIndex({
  spans,
  logs,
  traceCanonicalisation,
}: {
  spans: ClaudeSpanRef[];
  logs: ClaudeContentLog[];
  traceCanonicalisation: TraceCanonicalisationService;
}): Map<string, SpanInputOutput> {
  const bySpanId = new Map<string, SpanInputOutput>();

  const spansByQuerySource = groupBy(spans, (s) => querySourceKey(s.querySource));
  // Grouping by query_source isolates concurrent sources, but only while
  // BOTH sides carry the field. Claude Code 2.1.x stamps it on log events,
  // not on the llm_request span, so keying logs by it puts every body out
  // of any span's reach, degrading every model call to bare user_prompt
  // text. When no span declares a source, the whole trace pairs as one group.
  const spansDeclareQuerySource = spans.some((s) => s.querySource !== null);
  const requestBodiesByQuerySource = new Map<string, ClaudeContentLog[]>();
  const promptsByQuerySource = new Map<string, ClaudeContentLog[]>();
  for (const log of logs) {
    const key = spansDeclareQuerySource ? querySourceKey(log.querySource) : NULL_QUERY_SOURCE_KEY;
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
      const input = buildSpanInput({
        requestBody: requestBodies[i],
        prompts,
        traceCanonicalisation,
      });
      if (input !== null) {
        bySpanId.set(spansInGroup[i]!.spanId, input);
      }
    }
  }

  dedupeRepeatedSystemMessages({ spans, bySpanId });

  return bySpanId;
}

/**
 * Claude re-sends the identical system prompt on every call of a session, so a 20-call trace
 * repeats the same 40 KB of context 20 times. The full text stays on the first call carrying each
 * distinct system message and later copies become a short reference to it.
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
      if (seenAtCall === null) {
        continue;
      }

      messages[i] = repeatedSystemPlaceholder(message.content as string, seenAtCall);
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

function repeatedSystemPlaceholder(content: string, firstCall: number): ChatMessage {
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
  traceCanonicalisation,
}: {
  requestBody: ClaudeContentLog | undefined;
  prompts: ClaudeContentLog[];
  traceCanonicalisation: TraceCanonicalisationService;
}): SpanInputOutput | null {
  const messages =
    requestBody !== undefined
      ? traceCanonicalisation.deriveClaudeRequestContent({
          body: requestBody.body,
        }).messages
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
 * Chooses the user prompt text standing in for a truncated or absent request body: the latest
 * non-empty prompt at or before the body's time, which is the triggering user turn, else the
 * earliest non-empty prompt. Null when no prompt carries text.
 */
function pickPromptFallback({
  prompts,
  refTimeUnixMs,
}: {
  prompts: ClaudeContentLog[];
  refTimeUnixMs: number | undefined;
}): string | null {
  const withBody = prompts.filter((p) => p.body !== null && p.body.length > 0);
  if (withBody.length === 0) {
    return null;
  }

  if (refTimeUnixMs !== undefined) {
    let chosen: ClaudeContentLog | null = null;
    for (const p of withBody) {
      if (p.timeUnixMs <= refTimeUnixMs) {
        chosen = p;
      }
    }

    if (chosen !== null) {
      return chosen.body;
    }
  }

  return withBody[0]!.body;
}

export function normalizeRole(role: string | undefined): ChatRole {
  return role !== undefined && CHAT_ROLE_SET.has(role) ? (role as ChatRole) : "unknown";
}

export function querySourceKey(querySource: string | null): string {
  return querySource ?? NULL_QUERY_SOURCE_KEY;
}

export function byTimeAsc(a: ClaudeContentLog, b: ClaudeContentLog): number {
  return a.timeUnixMs - b.timeUnixMs;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    pushInto(out, key(item), item);
  }

  return out;
}

function pushInto<T>(map: Map<string, T[]>, key: string, item: T): void {
  const existing = map.get(key);
  if (existing !== undefined) {
    existing.push(item);
  } else {
    map.set(key, [item]);
  }
}
