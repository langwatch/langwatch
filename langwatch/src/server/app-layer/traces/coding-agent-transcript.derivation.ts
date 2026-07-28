import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";
import {
  type CodingAgent,
  detectCodingAgent,
  normalizeEventName,
  parseMcpToolName,
  resolveConversationKey,
  resolveToolName,
} from "~/server/event-sourcing/pipelines/coding-agent-processing/services/coding-agent-normalization";
import { isReplyTextPart } from "./canonicalisation/extractors/_parts";

/**
 * What a coding agent DID, in the order it did it — derived on the server.
 *
 * This is the transcript the Terminal view draws, and it lives here rather than
 * in the browser for one reason: it is not a rendering concern. The CLI wants it,
 * an MCP server wants it, and an export wants it, and none of them are going to
 * run React to get it. One derivation, one answer, every consumer.
 *
 * ## Why this reads spans + logs, and not the rolling message history
 *
 * The browser used to rebuild the transcript by parsing the LAST model call's
 * input — the whole conversation-so-far, which Claude Code helpfully carries on
 * every request. That worked, and it worked only for Claude Code: opencode,
 * Codex and Gemini do not send a rolling history at all, so there is nothing
 * there to parse. Ordering by timestamp across the tool spans and the log records
 * is the one method that works for every agent, and it needs no vendor-specific
 * message format.
 *
 * ## Why logs are not optional
 *
 * A tool the user DENIED never runs, so it has no span. It exists only as a
 * `tool_decision` log. Read only the spans and the transcript quietly omits every
 * moment a human said no — which is usually the moment they most want to find.
 */

/** One thing that happened, at a point in time. */
export type TranscriptEntry =
  | { kind: "user_prompt"; atMs: number; text: string | null; chars: number }
  | {
      kind: "assistant_message";
      atMs: number;
      text: string | null;
      model: string | null;
    }
  | {
      /**
       * A model call's own economics, positioned in the sequence at the moment
       * it happened. Separate from `assistant_message` (the TEXT, from the
       * logs) because the two come off different signals and only the span
       * knows the cost. Not meant to be its own line in a rendered transcript —
       * it exists so a reader scrubbing the session can see tokens/cost
       * accumulate at the right point without re-deriving it from spans.
       */
      kind: "model_call";
      atMs: number;
      model: string | null;
      tokens: number;
      costUsd: number;
      durationMs: number | null;
      spanId: string;
      /**
       * The cache split, not just the total — this is what lets a reader spot
       * WHICH call re-created the cache instead of reading from it. A cache
       * read bills at a fraction of fresh input; a cache write costs MORE than
       * it, so a call with a large `cacheCreationTokens` next to a small
       * `cacheReadTokens` is the session paying twice for the same context.
       */
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
    }
  | {
      kind: "tool";
      atMs: number;
      name: string;
      /** Set when the tool came from an MCP server, e.g. `claude-in-chrome`. */
      mcpServer: string | null;
      input: unknown;
      output: unknown;
      durationMs: number | null;
      failed: boolean;
      /** Present when a SUB-AGENT ran this tool, not the main thread. */
      agentId: string | null;
      spanId: string;
    }
  | {
      /** A tool that never ran: the human said no, or walked away. */
      kind: "tool_rejected";
      atMs: number;
      name: string | null;
      /** `reject` (said no) vs `user_abort` (stopped it mid-flight). */
      reason: string | null;
    }
  | {
      /** Something happened TO the session: compaction, an error, a rate limit. */
      kind: "note";
      atMs: number;
      level: "info" | "warning" | "error";
      event: string;
      text: string;
    };

export interface CodingAgentTranscript {
  agent: CodingAgent;
  /** The agent's own session id — the key that reaches its other traces. */
  sessionId: string | null;
  entries: TranscriptEntry[];
  totals: {
    modelCalls: number;
    toolCalls: number;
    tokens: number;
    costUsd: number;
  };
  /** Sub-agents that ran, by their id, with how many tools each one used. */
  subAgents: Array<{ agentId: string; toolCalls: number }>;
}

/** The log record shape this derivation needs. Structural, so callers can pass their own. */
export interface TranscriptLogRecord {
  timestampMs: number;
  attributes: Record<string, unknown>;
}

const MODEL_CALL_SPAN_NAMES = new Set([
  "claude_code.llm_request",
  "opencode.llm",
  // opencode 1.x instruments through the Vercel AI SDK.
  "ai.streamText",
  // gemini-cli's per-call span.
  "llm_call",
  // codex is contentless on OTel but its turn span carries token usage.
  "session_task.turn",
  "chat",
]);

/**
 * Inner/duplicate spans that must NOT count as model calls even though they
 * match a model-call prefix: the Vercel AI SDK nests the provider call
 * (`ai.streamText.doStream`) inside `ai.streamText`, and counting both
 * doubles every call.
 */
const MODEL_CALL_SPAN_EXCLUDES = new Set(["ai.streamText.doStream"]);

export function buildCodingAgentTranscript({
  spans,
  logs,
}: {
  spans: SpanDetail[];
  logs: TranscriptLogRecord[];
}): CodingAgentTranscript {
  const fromSpans = collectSpanEntries(spans);
  const fromLogs = collectLogEntries(logs);

  const entries = [...fromSpans.entries, ...fromLogs.entries];

  // Replies derived from span OUTPUT are held apart: when the same CALL also
  // has a reply-bearing LOG event (gemini emits both an llm_call span and an
  // api_response event for one call), the log wins and the span-derived
  // duplicate is dropped. Scoped per call, not per trace: with partial log
  // coverage (the log read is capped) a turn whose log reply was never
  // captured must still keep its span-derived text.
  const logReplyTimes = fromLogs.entries
    .filter((entry) => entry.kind === "assistant_message")
    .map((entry) => entry.atMs);
  for (const reply of fromSpans.spanReplies) {
    const duplicatedByLog = logReplyTimes.some(
      (atMs) =>
        atMs >= reply.windowStartMs &&
        atMs <= reply.windowEndMs + LOG_REPLY_FLUSH_SLACK_MS,
    );
    if (!duplicatedByLog) entries.push(reply.entry);
  }

  // Time is the only ordering every agent agrees on. Spans and logs arrive on
  // separate exporters and separate batches, so neither stream's arrival order
  // says anything about what actually happened first.
  entries.sort((a, b) => a.atMs - b.atMs);

  return {
    agent: detectAgentFrom({ spans, logs }),
    sessionId: fromLogs.sessionId,
    entries,
    totals: fromSpans.totals,
    subAgents: [...fromSpans.subAgentToolCounts.entries()]
      .map(([agentId, count]) => ({ agentId, toolCalls: count }))
      .sort((a, b) => b.toolCalls - a.toolCalls),
  };
}

/**
 * How far after its span's end a call's log-borne reply may land and still be
 * that call's (the event flushes with the response, so in practice within a
 * couple of seconds). Kept tight: the NEXT turn's reply must never fall in.
 */
const LOG_REPLY_FLUSH_SLACK_MS = 2_000;

/** A span-derived reply plus the call window a log duplicate would land in. */
interface SpanReply {
  entry: TranscriptEntry;
  windowStartMs: number;
  windowEndMs: number;
}

function collectSpanEntries(spans: SpanDetail[]): {
  entries: TranscriptEntry[];
  spanReplies: SpanReply[];
  totals: CodingAgentTranscript["totals"];
  subAgentToolCounts: Map<string, number>;
} {
  const entries: TranscriptEntry[] = [];
  const spanReplies: SpanReply[] = [];
  const subAgentToolCounts = new Map<string, number>();
  const totals = { modelCalls: 0, toolCalls: 0, tokens: 0, costUsd: 0 };

  for (const span of spans) {
    if (isModelCallSpan(span.name)) {
      const call = modelCallEntry(span);
      totals.modelCalls += 1;
      totals.tokens += call.tokens;
      totals.costUsd += call.costUsd;
      entries.push(call);
      // Agents whose reply rides the SPAN (opencode via the Vercel AI SDK,
      // copilot with content capture, gemini's llm_call) get their assistant
      // message from the span's extracted output. Claude never lands here:
      // its spans carry no content, the reply comes off the log events.
      const spanReplyText =
        extractedOutputText(span.output) ??
        outputMessagesText(readString(span.params, "gen_ai.output.messages"));
      if (spanReplyText !== null) {
        spanReplies.push({
          entry: {
            kind: "assistant_message",
            atMs: span.endTimeMs ?? span.startTimeMs,
            text: spanReplyText,
            model: modelOf(span),
          },
          windowStartMs: span.startTimeMs,
          windowEndMs: span.endTimeMs ?? span.startTimeMs,
        });
      }
      continue;
    }

    // A span is a tool run when it DECLARES a tool: either by attribute
    // (`tool_name` / `tool.name` — claude, codex) or by the opencode span-name
    // encoding. No name allowlist on top: the declaration is the evidence, and
    // an allowlist here silently dropped attribute-backed tools under span
    // names it had never seen.
    const toolName = resolveToolName({
      spanName: span.name,
      attrs: (span.params ?? {}) as Record<string, unknown>,
    });
    if (toolName === null) continue;

    totals.toolCalls += 1;

    // A sub-agent's tools are kept IN the sequence but marked, rather than
    // hoisted out of it. Dropping them lost the work entirely; flattening them
    // into the main thread pretended the main thread did it.
    const agentId = readString(span.params, "agent_id");
    if (agentId !== null) {
      subAgentToolCounts.set(
        agentId,
        (subAgentToolCounts.get(agentId) ?? 0) + 1,
      );
    }

    entries.push({
      kind: "tool",
      atMs: span.startTimeMs,
      name: toolName,
      mcpServer: parseMcpToolName(toolName)?.server ?? null,
      input: span.input ?? null,
      output: span.output ?? null,
      durationMs:
        span.endTimeMs && span.startTimeMs
          ? span.endTimeMs - span.startTimeMs
          : null,
      // Both signals, because they are set independently: a span can carry an
      // error payload, or simply an error STATUS with no payload at all.
      failed: span.status === "error" || span.error != null,
      agentId,
      spanId: span.spanId,
    });
  }

  return { entries, spanReplies, totals, subAgentToolCounts };
}

function modelCallEntry(span: SpanDetail): TranscriptEntry & {
  kind: "model_call";
} {
  const inputTokens =
    readNumber(span.params, "input_tokens") ??
    readNumber(span.params, "gen_ai.usage.input_tokens") ??
    // opencode instruments through the Vercel AI SDK (v5 names).
    readNumber(span.params, "ai.usage.inputTokens") ??
    // codex reports per-turn usage under its own namespace.
    readNumber(span.params, "codex.turn.token_usage.non_cached_input_tokens") ??
    0;
  const outputTokens =
    readNumber(span.params, "output_tokens") ??
    readNumber(span.params, "gen_ai.usage.output_tokens") ??
    readNumber(span.params, "ai.usage.outputTokens") ??
    readNumber(span.params, "codex.turn.token_usage.output_tokens") ??
    0;
  const metricTokens =
    (span.metrics?.promptTokens ?? 0) + (span.metrics?.completionTokens ?? 0);
  const tokens =
    metricTokens > 0
      ? metricTokens
      : (readNumber(span.params, "codex.turn.token_usage.total_tokens") ??
        inputTokens + outputTokens);

  return {
    kind: "model_call",
    atMs: span.startTimeMs,
    model: modelOf(span),
    tokens,
    costUsd: span.metrics?.cost ?? 0,
    durationMs:
      span.endTimeMs && span.startTimeMs
        ? span.endTimeMs - span.startTimeMs
        : null,
    spanId: span.spanId,
    inputTokens,
    outputTokens,
    cacheReadTokens:
      readNumber(span.params, "cache_read_tokens") ??
      readNumber(span.params, "gen_ai.usage.cache_read.input_tokens") ??
      0,
    cacheCreationTokens:
      readNumber(span.params, "cache_creation_tokens") ??
      readNumber(span.params, "gen_ai.usage.cache_creation.input_tokens") ??
      0,
  };
}

function modelOf(span: SpanDetail): string | null {
  return (
    readString(span.params, "gen_ai.request.model") ??
    readString(span.params, "ai.model.id") ??
    readString(span.params, "model")
  );
}

function collectLogEntries(logs: TranscriptLogRecord[]): {
  entries: TranscriptEntry[];
  sessionId: string | null;
} {
  const entries: TranscriptEntry[] = [];
  let sessionId: string | null = null;

  for (const log of logs) {
    const event = normalizeEventName(readString(log.attributes, "event.name"));
    if (event === null) continue;

    sessionId ??= resolveConversationKey(log.attributes);

    const entry = logToEntry({ event, log });
    if (entry !== null) entries.push(entry);
  }

  return { entries, sessionId };
}

function logToEntry({
  event,
  log,
}: {
  event: string;
  log: TranscriptLogRecord;
}): TranscriptEntry | null {
  const attrs = log.attributes;
  const atMs = log.timestampMs;

  switch (event) {
    case "user_prompt": {
      const text = readString(attrs, "prompt");
      return {
        kind: "user_prompt",
        atMs,
        text,
        chars: text?.length ?? readNumber(attrs, "prompt_length") ?? 0,
      };
    }

    case "assistant_response":
      return {
        kind: "assistant_message",
        atMs,
        text: readString(attrs, "response"),
        model: readString(attrs, "model"),
      };

    case "api_response": {
      // Gemini's reply rides `response_text` on its api_response event, as
      // the raw candidates JSON. Claude's api_response events carry no
      // response_text, so this case is inert for them. Gemini also runs
      // utility calls (its model router) whose "reply" is internal JSON; the
      // `role` attr separates those from the conversation - only `main`
      // answers the user, mirroring claude's query_source gate.
      const role = readString(attrs, "role");
      if (role !== null && role !== "main") return null;
      const text = geminiResponseText(readString(attrs, "response_text"));
      if (text === null) return null;
      return {
        kind: "assistant_message",
        atMs,
        text,
        model: readString(attrs, "model"),
      };
    }

    case "tool_result": {
      // Gemini tools exist only as this log event (its tool_call, which the
      // vocabulary maps here): no span exists for them. A rejected decision
      // means the human said no and nothing ran. Claude tool_result logs
      // carry no function_name, so they fall through to null and claude
      // tools keep coming from their spans.
      const name = readString(attrs, "function_name");
      if (name === null) return null;
      const decision = readString(attrs, "decision");
      if (decision === "reject") {
        return { kind: "tool_rejected", atMs, name, reason: decision };
      }
      return {
        kind: "tool",
        atMs,
        name,
        mcpServer: parseMcpToolName(name)?.server ?? null,
        input: null,
        output: null,
        durationMs: readNumber(attrs, "duration_ms"),
        failed: readString(attrs, "success") === "false",
        agentId: null,
        spanId: "",
      };
    }

    case "tool_decision": {
      // The ONLY record of a tool the human refused: it never ran, so no span
      // for it exists anywhere in the trace.
      const decision = readString(attrs, "decision");
      if (decision === null || decision === "accept") return null;
      return {
        kind: "tool_rejected",
        atMs,
        name: readString(attrs, "tool_name"),
        reason: readString(attrs, "source") ?? decision,
      };
    }

    case "compaction": {
      const pre = readNumber(attrs, "pre_tokens");
      const post = readNumber(attrs, "post_tokens");
      const trigger = readString(attrs, "trigger") ?? "auto";
      return {
        kind: "note",
        atMs,
        level: "info",
        event,
        text:
          pre !== null && post !== null
            ? `Context compacted (${trigger}): ${formatTokenCount(pre)} → ${formatTokenCount(post)} tokens`
            : `Context compacted (${trigger})`,
      };
    }

    case "permission_mode_changed":
      return {
        kind: "note",
        atMs,
        level: "warning",
        event,
        text: `Approval mode changed to ${readString(attrs, "to_mode") ?? "unknown"}.`,
      };

    case "api_error": {
      const status = readString(attrs, "status_code");
      return {
        kind: "note",
        atMs,
        level: "error",
        event,
        // A 429 is worth telling apart from every other failure: it is time
        // spent waiting, not working.
        text:
          status === "429"
            ? "Rate limited by the provider."
            : `The request failed${status ? ` (${status})` : ""}.`,
      };
    }

    case "retries_exhausted":
      return {
        kind: "note",
        atMs,
        level: "error",
        event,
        text: "Gave up after retrying — whatever this was doing did not happen.",
      };

    case "session_error":
    case "internal_error":
      return {
        kind: "note",
        atMs,
        level: "error",
        event,
        text: readString(attrs, "error") ?? "The session hit an error.",
      };

    case "api_refusal":
      return {
        kind: "note",
        atMs,
        level: "error",
        event,
        text: "The model refused to answer.",
      };

    case "subtask_invoked": {
      const description = readString(attrs, "description");
      return {
        kind: "note",
        atMs,
        level: "info",
        event,
        text: description
          ? `Sub-agent spawned: ${description}`
          : "A sub-agent was spawned.",
      };
    }

    case "commit": {
      const message = readString(attrs, "message");
      return {
        kind: "note",
        atMs,
        level: "info",
        event,
        text: message ? `Commit created: ${message}` : "A commit was created.",
      };
    }

    case "skill_activated": {
      const skill =
        readString(attrs, "skill_name") ?? readString(attrs, "skill");
      return {
        kind: "note",
        atMs,
        level: "info",
        event,
        text: skill ? `Skill activated: ${skill}` : "A skill was activated.",
      };
    }

    // Deliberately NOT transcript entries: `api_request` (the request side is
    // already the model_call span — a second line per call would double every
    // beat), `session_created` / `session_idle` (lifecycle bookkeeping, no
    // conversational content), and `mcp_server_connection` /
    // `hook_execution_complete` / `at_mention` (session setup and input
    // mechanics — the fold counts them; a replay of the conversation does not
    // relive them).
    default:
      return null;
  }
}

function detectAgentFrom({
  spans,
  logs,
}: {
  spans: SpanDetail[];
  logs: TranscriptLogRecord[];
}): CodingAgent {
  for (const span of spans) {
    const agent = detectCodingAgent({ recordName: span.name });
    if (agent !== "unknown") return agent;
    // opencode's spans are named by the Vercel AI SDK (`ai.streamText`), so
    // the name carries no agent; its request-header attributes do.
    const headers = readValue(span.params, "ai.request.headers");
    if (
      headers !== null &&
      typeof headers === "object" &&
      Object.keys(headers as Record<string, unknown>).some((key) =>
        key.startsWith("x-opencode"),
      )
    ) {
      return "opencode";
    }
  }
  for (const log of logs) {
    const agent = detectCodingAgent({
      recordName: readString(log.attributes, "event.name"),
    });
    if (agent !== "unknown") return agent;
  }
  return "unknown";
}

/**
 * Exported for the drawer's session banner, which answers "which model did
 * this session end on" over the same spans — one predicate, or the two
 * drift (they already had, over the doStream exclude).
 */
export function isModelCallSpan(spanName: string): boolean {
  if (MODEL_CALL_SPAN_EXCLUDES.has(spanName)) return false;
  if (MODEL_CALL_SPAN_NAMES.has(spanName)) return true;
  // Copilot names its call span after the operation AND the model
  // ("chat gpt-5-mini"), so the exact-name set can never list it.
  return spanName.startsWith("chat ");
}

/**
 * The reply text out of a span's canonical extracted output, which arrives
 * serialized: either bare text or a `{type, value}` SpanInputOutput JSON.
 * For chat_messages the LAST assistant text wins — the final answer, not the
 * mid-run tool chatter.
 */
function extractedOutputText(output: string | null | undefined): string | null {
  if (typeof output !== "string" || output.trim().length === 0) return null;
  const raw = output.trim();
  if (!raw.startsWith("{") && !raw.startsWith("[")) return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "string") return parsed.length > 0 ? parsed : null;
    // A bare chat array ([{role, content}]) is how the read path serializes
    // an extracted conversation output.
    if (Array.isArray(parsed)) return messagesReplyText(parsed);
    if (parsed && typeof parsed === "object") {
      const io = parsed as { type?: unknown; value?: unknown };
      if (io.type === "text" && typeof io.value === "string") {
        return io.value.length > 0 ? io.value : null;
      }
      if (io.type === "chat_messages" && Array.isArray(io.value)) {
        return messagesReplyText(io.value);
      }
    }
    return null;
  } catch {
    return raw;
  }
}

/**
 * A dotted key resolves against BOTH attribute shapes: log attributes keep
 * their dotted keys flat, while the span mapper unflattens them into nested
 * objects on `Span.params` (`gen_ai.request.model` becomes
 * `params.gen_ai.request.model`). Flat wins so a literal dotted key is never
 * shadowed by an unrelated nested one.
 */
function readValue(
  attrs: Record<string, unknown> | null | undefined,
  key: string,
): unknown {
  if (!attrs) return undefined;
  if (attrs[key] !== undefined) return attrs[key];
  if (!key.includes(".")) return undefined;
  let cursor: unknown = attrs;
  for (const segment of key.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * Exported alongside {@link isModelCallSpan} for the session banner: any
 * reader of `SpanDetail.params` needs the dual-shape resolution or nested
 * params silently read as absent.
 */
export function readString(
  attrs: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = readValue(attrs, key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(
  attrs: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const value = readValue(attrs, key);
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatTokenCount(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/**
 * The reply out of a `gen_ai.output.messages` span attribute: a JSON array of
 * messages whose parts mix thinking (`thought: true`), empty thoughtSignature
 * padding, tool calls, and the actual reply text. The LAST message with
 * untagged text wins.
 */
function outputMessagesText(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return messagesReplyText(Array.isArray(parsed) ? parsed : [parsed]);
  } catch {
    return null;
  }
}

/**
 * The reply out of a message array: the LAST message with untagged text
 * wins, whether the text rides `content` (string or typed parts) or gemini's
 * `parts` (where `thought: true` marks thinking and empty thoughtSignature
 * entries pad the tail).
 */
function messagesReplyText(messages: unknown[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as {
      role?: unknown;
      content?: unknown;
      parts?: unknown;
    } | null;
    if (!message) continue;
    if (
      message.role !== undefined &&
      message.role !== "assistant" &&
      message.role !== "model"
    ) {
      continue;
    }
    if (typeof message.content === "string" && message.content.length > 0) {
      return message.content;
    }
    if (Array.isArray(message.parts)) {
      const texts: string[] = [];
      for (const part of message.parts) {
        const p = part as { text?: unknown; thought?: unknown };
        if (isReplyTextPart(p)) texts.push(p.text);
      }
      if (texts.length > 0) return texts.join("\n");
    }
    if (Array.isArray(message.content)) {
      const texts: string[] = [];
      for (const part of message.content) {
        const p = part as { text?: unknown; type?: unknown };
        const partType = p.type;
        if (
          (partType === undefined ||
            partType === "text" ||
            partType === "output_text") &&
          isReplyTextPart(p)
        ) {
          texts.push(p.text);
        }
      }
      if (texts.length > 0) return texts.join("\n");
    }
  }
  return null;
}

/**
 * The final answer out of gemini's `response_text` payload: a JSON
 * candidates array (or single candidates object) whose parts mix thinking
 * (`thought: true`), empty thoughtSignature padding, and the actual reply.
 * Only untagged, non-empty text parts are the reply.
 */
function geminiResponseText(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const roots = Array.isArray(parsed) ? parsed : [parsed];
    const texts: string[] = [];
    for (const root of roots) {
      const candidates = (root as { candidates?: unknown })?.candidates;
      if (!Array.isArray(candidates)) continue;
      for (const candidate of candidates) {
        const parts = (candidate as { content?: { parts?: unknown } })?.content
          ?.parts;
        if (!Array.isArray(parts)) continue;
        for (const part of parts) {
          const p = part as { text?: unknown; thought?: unknown };
          if (isReplyTextPart(p)) texts.push(p.text);
        }
      }
    }
    return texts.length > 0 ? texts.join("\n") : null;
  } catch {
    return raw;
  }
}
