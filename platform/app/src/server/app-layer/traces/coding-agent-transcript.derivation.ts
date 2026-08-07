import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";
import type { CodingAgent } from "~/server/event-sourcing/pipelines/coding-agent-processing/agents/_types";
import {
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
  | {
      /**
       * The session's system context, CLAUDE.md, MCP tool definitions,
       * skills, from the FIRST model call's system message. Emitted once and
       * pinned to the top: it is what every call of the session pays for, not
       * a moment in the sequence.
       */
      kind: "system_prompt";
      atMs: number;
      text: string;
      chars: number;
    }
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
  /**
   * Resource-level service.name, when the caller has it. The only signal
   * that separates Cowork from the Claude Code runtime it reuses.
   */
  serviceName?: string | null;
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
  // A codex tool run is recorded twice: a span carrying the tool's identity
  // and timing but no content, and a `tool_result` log carrying the
  // arguments and output under the same `call_id`. Index the logs first so
  // a tool span can be filled from its log, and so the log pass renders only
  // the calls no span already represents. Codex tool spans normally never
  // reach storage (the ingest noise filter drops them, since codex gives them
  // a parent in another trace), so in practice the log side does the work,
  // but the join keeps traces stored before that filter, and any run with the
  // filter's kill-switch set, from rendering every tool call twice.
  const codexToolLogs = indexCodexToolLogsByCallId(logs);
  const fromSpans = collectSpanEntries(spans, codexToolLogs);
  const fromLogs = collectLogEntries(logs, fromSpans.claimedToolCallIds);

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

  // The system context is pinned above the first prompt regardless of
  // timestamps: the user's prompt log fires BEFORE the first model call span
  // starts, so pure time ordering would bury the session's context below the
  // conversation it applies to.
  const systemIndex = entries.findIndex((e) => e.kind === "system_prompt");
  if (systemIndex > 0) {
    const [systemEntry] = entries.splice(systemIndex, 1);
    if (systemEntry) entries.unshift(systemEntry);
  }

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

/** A codex tool_result log's content, joinable to its span by call_id. */
interface CodexToolLogContent {
  input: unknown;
  output: unknown;
  failed: boolean;
}

/**
 * codex tool_result logs are recognised by shape, not scope: they carry a
 * `call_id` plus `arguments`/`output`, attributes claude's tool events never
 * use, and their `event.name` keeps the `codex.` prefix on the wire.
 */
function indexCodexToolLogsByCallId(
  logs: TranscriptLogRecord[],
): Map<string, CodexToolLogContent> {
  const byCallId = new Map<string, CodexToolLogContent>();
  for (const log of logs) {
    if (readString(log.attributes, "event.name") !== "codex.tool_result") {
      continue;
    }
    const callId = readString(log.attributes, "call_id");
    if (callId === null || byCallId.has(callId)) continue;
    byCallId.set(callId, {
      input: parseMaybeJson(readString(log.attributes, "arguments")),
      output: readString(log.attributes, "output"),
      failed: readString(log.attributes, "success") === "false",
    });
  }
  return byCallId;
}

/** Parse a JSON-looking string for structured rendering; pass others through. */
function parseMaybeJson(raw: string | null): unknown {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return raw;
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

interface SpanEntryAccumulator {
  entries: TranscriptEntry[];
  spanReplies: SpanReply[];
  totals: CodingAgentTranscript["totals"];
  subAgentToolCounts: Map<string, number>;
  claimedToolCallIds: Set<string>;
  /** The session's system context is emitted once, off the first call carrying one. */
  hasEmittedSystemPrompt: boolean;
}

function collectSpanEntries(
  spans: SpanDetail[],
  codexToolLogs: Map<string, CodexToolLogContent>,
): SpanEntryAccumulator {
  const acc: SpanEntryAccumulator = {
    entries: [],
    spanReplies: [],
    totals: { modelCalls: 0, toolCalls: 0, tokens: 0, costUsd: 0 },
    subAgentToolCounts: new Map(),
    claimedToolCallIds: new Set(),
    hasEmittedSystemPrompt: false,
  };

  // codex 0.146's exec wire has no `session_task.turn` rollup, its
  // usage-bearing `handle_responses` spans are the model calls. When the
  // rollup IS present (the TUI wire), those same spans are its per-response
  // parts and counting both would double every call.
  const hasCodexTurnRollup = spans.some(
    (span) => span.name === "session_task.turn",
  );

  for (const span of spans) {
    const isCodexResponseCall =
      !hasCodexTurnRollup &&
      span.name === "handle_responses" &&
      readNumber(span.params, "gen_ai.usage.input_tokens") !== null;
    if (isModelCallSpan(span.name) || isCodexResponseCall) {
      collectModelCallSpan(span, acc);
    } else {
      collectToolSpan(span, acc, codexToolLogs);
    }
  }

  return acc;
}

function collectModelCallSpan(
  span: SpanDetail,
  acc: SpanEntryAccumulator,
): void {
  const call = modelCallEntry(span);
  acc.totals.modelCalls += 1;
  acc.totals.tokens += call.tokens;
  acc.totals.costUsd += call.costUsd;
  acc.entries.push(call);

  // Only claude's enriched llm_request inputs carry a system message;
  // codex/opencode/gemini model spans have none.
  const systemText = acc.hasEmittedSystemPrompt
    ? null
    : extractedSystemText(span.input);
  if (systemText !== null) {
    acc.hasEmittedSystemPrompt = true;
    acc.entries.push({
      kind: "system_prompt",
      atMs: span.startTimeMs,
      text: systemText,
      chars: systemText.length,
    });
  }

  // Agents whose reply rides the SPAN (opencode via the Vercel AI SDK,
  // copilot with content capture, gemini's llm_call) get their assistant
  // message from the span's extracted output. Claude never lands here:
  // its spans carry no content, the reply comes off the log events.
  const spanReplyText =
    extractedOutputText(span.output) ??
    outputMessagesText(readString(span.params, "gen_ai.output.messages"));
  if (spanReplyText === null) return;
  acc.spanReplies.push({
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

function collectToolSpan(
  span: SpanDetail,
  acc: SpanEntryAccumulator,
  codexToolLogs: Map<string, CodexToolLogContent>,
): void {
  // A span is a tool run when it DECLARES a tool: either by attribute
  // (`tool_name` / `tool.name`, for claude and codex) or by the opencode span-name
  // encoding. No name allowlist on top: the declaration is the evidence, and
  // an allowlist here silently dropped attribute-backed tools under span
  // names it had never seen.
  const toolName = resolveToolName({
    spanName: span.name,
    attrs: (span.params ?? {}) as Record<string, unknown>,
  });
  if (toolName === null) return;

  acc.totals.toolCalls += 1;

  // A sub-agent's tools are kept IN the sequence but marked, rather than
  // hoisted out of it. Dropping them lost the work entirely; flattening them
  // into the main thread pretended the main thread did it.
  const agentId = readString(span.params, "agent_id");
  if (agentId !== null) {
    acc.subAgentToolCounts.set(
      agentId,
      (acc.subAgentToolCounts.get(agentId) ?? 0) + 1,
    );
  }

  // A codex tool span records the run but not its content, that rides the
  // tool_result log sharing the span's call_id. Claim the call_id either
  // way so the log pass never renders the same call twice.
  const callId = readString(span.params, "call_id");
  const logContent = callId !== null ? codexToolLogs.get(callId) : undefined;
  if (callId !== null) acc.claimedToolCallIds.add(callId);

  acc.entries.push({
    kind: "tool",
    atMs: span.startTimeMs,
    name: toolName,
    mcpServer: parseMcpToolName(toolName)?.server ?? null,
    input: span.input ?? logContent?.input ?? null,
    output: span.output ?? logContent?.output ?? null,
    durationMs: spanDurationMs(span),
    // Both signals, because they are set independently: a span can carry an
    // error payload, or simply an error STATUS with no payload at all.
    failed:
      span.status === "error" || span.error != null || isFailed(logContent),
    agentId,
    spanId: span.spanId,
  });
}

function spanDurationMs(span: SpanDetail): number | null {
  return span.endTimeMs && span.startTimeMs
    ? span.endTimeMs - span.startTimeMs
    : null;
}

function isFailed(logContent: CodexToolLogContent | undefined): boolean {
  return logContent?.failed ?? false;
}

/** The first key (in priority order) that resolves to a number, or null. */
function firstNumber(
  params: Record<string, unknown> | null | undefined,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = readNumber(params, key);
    if (value !== null) return value;
  }
  return null;
}

function tokensForModelCall({
  span,
  inputTokens,
  outputTokens,
}: {
  span: SpanDetail;
  inputTokens: number;
  outputTokens: number;
}): number {
  const metricTokens =
    (span.metrics?.promptTokens ?? 0) + (span.metrics?.completionTokens ?? 0);
  if (metricTokens > 0) return metricTokens;
  return (
    readNumber(span.params, "codex.turn.token_usage.total_tokens") ??
    inputTokens + outputTokens
  );
}

function modelCallEntry(span: SpanDetail): TranscriptEntry & {
  kind: "model_call";
} {
  const inputTokens =
    firstNumber(span.params, [
      "input_tokens",
      "gen_ai.usage.input_tokens",
      // opencode instruments through the Vercel AI SDK (v5 names).
      "ai.usage.inputTokens",
      // codex reports per-turn usage under its own namespace.
      "codex.turn.token_usage.non_cached_input_tokens",
    ]) ?? 0;
  const outputTokens =
    firstNumber(span.params, [
      "output_tokens",
      "gen_ai.usage.output_tokens",
      "ai.usage.outputTokens",
      "codex.turn.token_usage.output_tokens",
    ]) ?? 0;
  const cacheReadTokens =
    firstNumber(span.params, [
      "cache_read_tokens",
      "gen_ai.usage.cache_read.input_tokens",
    ]) ?? 0;
  const cacheCreationTokens =
    firstNumber(span.params, [
      "cache_creation_tokens",
      "gen_ai.usage.cache_creation.input_tokens",
      // codex spells cache creation "cache_write", on both its span shapes.
      "gen_ai.usage.cache_write.input_tokens",
      "codex.turn.token_usage.cache_write_input_tokens",
    ]) ?? 0;

  return {
    kind: "model_call",
    atMs: span.startTimeMs,
    model: modelOf(span),
    tokens: tokensForModelCall({ span, inputTokens, outputTokens }),
    costUsd: span.metrics?.cost ?? 0,
    durationMs: spanDurationMs(span),
    spanId: span.spanId,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
  };
}

function modelOf(span: SpanDetail): string | null {
  return (
    readString(span.params, "gen_ai.request.model") ??
    readString(span.params, "ai.model.id") ??
    readString(span.params, "model")
  );
}

function collectLogEntries(
  logs: TranscriptLogRecord[],
  claimedToolCallIds: Set<string>,
): {
  entries: TranscriptEntry[];
  sessionId: string | null;
} {
  const entries: TranscriptEntry[] = [];
  let sessionId: string | null = null;

  for (const log of logs) {
    const event = normalizeEventName(readString(log.attributes, "event.name"));
    if (event === null) continue;

    sessionId ??= resolveConversationKey(log.attributes);

    const entry = logToEntry({ event, log, claimedToolCallIds });
    if (entry !== null) entries.push(entry);
  }

  return { entries, sessionId };
}

/** Context a single log-entry handler needs to build (or decline) an entry. */
interface LogEntryContext {
  attrs: Record<string, unknown>;
  atMs: number;
  event: string;
  claimedToolCallIds: Set<string>;
}

function userPromptEntry({ attrs, atMs }: LogEntryContext): TranscriptEntry {
  const text = readString(attrs, "prompt");
  return {
    kind: "user_prompt",
    atMs,
    text,
    chars: text?.length ?? readNumber(attrs, "prompt_length") ?? 0,
  };
}

function assistantResponseEntry({
  attrs,
  atMs,
}: LogEntryContext): TranscriptEntry {
  return {
    kind: "assistant_message",
    atMs,
    text: readString(attrs, "response"),
    model: readString(attrs, "model"),
  };
}

// Gemini's reply rides `response_text` on its api_response event, as the raw
// candidates JSON. Claude's api_response events carry no response_text, so
// this case is inert for them. Gemini also runs utility calls (its model
// router) whose "reply" is internal JSON; the `role` attr separates those
// from the conversation - only `main` answers the user, mirroring claude's
// query_source gate.
function apiResponseEntry({
  attrs,
  atMs,
}: LogEntryContext): TranscriptEntry | null {
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

// codex tool_result logs (recognised by their call_id + arguments shape) are
// the CONTENT record of a codex tool run. When a tool span claimed the
// call_id, the span entry already carries this log's content; unclaimed
// calls (the model-facing harness call, MCP calls without spans, span-less
// wires) render from the log alone.
function codexToolResultEntry({
  attrs,
  atMs,
  claimedToolCallIds,
  callId,
}: LogEntryContext & { callId: string }): TranscriptEntry | null {
  if (claimedToolCallIds.has(callId)) return null;
  const codexToolName = readString(attrs, "tool_name");
  if (codexToolName === null) return null;
  const mcpServer = readString(attrs, "mcp_server");
  return {
    kind: "tool",
    atMs,
    name: codexToolName,
    mcpServer: mcpServer ?? parseMcpToolName(codexToolName)?.server ?? null,
    input: parseMaybeJson(readString(attrs, "arguments")),
    output: readString(attrs, "output"),
    durationMs: readNumber(attrs, "duration_ms"),
    failed: readString(attrs, "success") === "false",
    agentId: null,
    spanId: "",
  };
}

// Gemini tools exist only as this log event (its tool_call, which the
// vocabulary maps here): no span exists for them. A rejected decision means
// the human said no and nothing ran. Claude tool_result logs carry no
// function_name, so they fall through to null and claude tools keep coming
// from their spans.
function genericToolResultEntry({
  attrs,
  atMs,
}: LogEntryContext): TranscriptEntry | null {
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

function toolResultEntry(ctx: LogEntryContext): TranscriptEntry | null {
  const callId = readString(ctx.attrs, "call_id");
  if (
    callId !== null &&
    readString(ctx.attrs, "event.name") === "codex.tool_result"
  ) {
    return codexToolResultEntry({ ...ctx, callId });
  }
  return genericToolResultEntry(ctx);
}

// The ONLY record of a tool the human refused: it never ran, so no span for
// it exists anywhere in the trace.
function toolDecisionEntry({
  attrs,
  atMs,
}: LogEntryContext): TranscriptEntry | null {
  const decision = readString(attrs, "decision");
  if (decision === null || decision === "accept") return null;
  return {
    kind: "tool_rejected",
    atMs,
    name: readString(attrs, "tool_name"),
    reason: readString(attrs, "source") ?? decision,
  };
}

function compactionEntry({
  attrs,
  atMs,
  event,
}: LogEntryContext): TranscriptEntry {
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

function permissionModeChangedEntry({
  attrs,
  atMs,
  event,
}: LogEntryContext): TranscriptEntry {
  return {
    kind: "note",
    atMs,
    level: "warning",
    event,
    text: `Approval mode changed to ${readString(attrs, "to_mode") ?? "unknown"}.`,
  };
}

// A 429 is worth telling apart from every other failure: it is time spent
// waiting, not working.
function apiErrorEntry({
  attrs,
  atMs,
  event,
}: LogEntryContext): TranscriptEntry {
  const status = readString(attrs, "status_code");
  return {
    kind: "note",
    atMs,
    level: "error",
    event,
    text:
      status === "429"
        ? "Rate limited by the provider."
        : `The request failed${status ? ` (${status})` : ""}.`,
  };
}

function retriesExhaustedEntry({
  atMs,
  event,
}: LogEntryContext): TranscriptEntry {
  return {
    kind: "note",
    atMs,
    level: "error",
    event,
    text: "Gave up after retrying — whatever this was doing did not happen.",
  };
}

function sessionErrorEntry({
  attrs,
  atMs,
  event,
}: LogEntryContext): TranscriptEntry {
  return {
    kind: "note",
    atMs,
    level: "error",
    event,
    text: readString(attrs, "error") ?? "The session hit an error.",
  };
}

function apiRefusalEntry({ atMs, event }: LogEntryContext): TranscriptEntry {
  return {
    kind: "note",
    atMs,
    level: "error",
    event,
    text: "The model refused to answer.",
  };
}

function subtaskInvokedEntry({
  attrs,
  atMs,
  event,
}: LogEntryContext): TranscriptEntry {
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

function commitEntry({ attrs, atMs, event }: LogEntryContext): TranscriptEntry {
  const message = readString(attrs, "message");
  return {
    kind: "note",
    atMs,
    level: "info",
    event,
    text: message ? `Commit created: ${message}` : "A commit was created.",
  };
}

function skillActivatedEntry({
  attrs,
  atMs,
  event,
}: LogEntryContext): TranscriptEntry {
  const skill = readString(attrs, "skill_name") ?? readString(attrs, "skill");
  return {
    kind: "note",
    atMs,
    level: "info",
    event,
    text: skill ? `Skill activated: ${skill}` : "A skill was activated.",
  };
}

// Deliberately NOT transcript entries (absent from the table below):
// `api_request` (the request side is already the model_call span — a second
// line per call would double every beat), `session_created` / `session_idle`
// (lifecycle bookkeeping, no conversational content), and
// `mcp_server_connection` / `hook_execution_complete` / `at_mention` (session
// setup and input mechanics — the fold counts them; a replay of the
// conversation does not relive them).
const LOG_ENTRY_HANDLERS: Record<
  string,
  (ctx: LogEntryContext) => TranscriptEntry | null
> = {
  user_prompt: userPromptEntry,
  assistant_response: assistantResponseEntry,
  api_response: apiResponseEntry,
  tool_result: toolResultEntry,
  tool_decision: toolDecisionEntry,
  compaction: compactionEntry,
  permission_mode_changed: permissionModeChangedEntry,
  api_error: apiErrorEntry,
  retries_exhausted: retriesExhaustedEntry,
  session_error: sessionErrorEntry,
  internal_error: sessionErrorEntry,
  api_refusal: apiRefusalEntry,
  subtask_invoked: subtaskInvokedEntry,
  commit: commitEntry,
  skill_activated: skillActivatedEntry,
};

function logToEntry({
  event,
  log,
  claimedToolCallIds,
}: {
  event: string;
  log: TranscriptLogRecord;
  claimedToolCallIds: Set<string>;
}): TranscriptEntry | null {
  const handler = LOG_ENTRY_HANDLERS[event];
  if (!handler) return null;
  return handler({
    attrs: log.attributes,
    atMs: log.timestampMs,
    event,
    claimedToolCallIds,
  });
}

function detectAgentFrom({
  spans,
  logs,
}: {
  spans: SpanDetail[];
  logs: TranscriptLogRecord[];
}): CodingAgent {
  // Logs first, deliberately. They are the only records here that carry
  // `service.name`, which is the sole signal separating agents that share a
  // runtime: Cowork emits `claude_code.*` span names, so a span-first scan
  // matches `claude_code` and returns before the logs — which know better —
  // are ever consulted. Spans still decide for agents that send no logs.
  for (const log of logs) {
    const agent = detectCodingAgent({
      recordName: readString(log.attributes, "event.name"),
      serviceName: log.serviceName,
    });
    if (agent !== "unknown") return agent;
  }
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
function outputContainerText(io: {
  type?: unknown;
  value?: unknown;
}): string | null {
  if (io.type === "text" && typeof io.value === "string") {
    return io.value.length > 0 ? io.value : null;
  }
  if (io.type === "chat_messages" && Array.isArray(io.value)) {
    return messagesReplyText(io.value);
  }
  return null;
}

function parsedOutputText(parsed: unknown): string | null {
  if (typeof parsed === "string") return parsed.length > 0 ? parsed : null;
  // A bare chat array ([{role, content}]) is how the read path serializes
  // an extracted conversation output.
  if (Array.isArray(parsed)) return messagesReplyText(parsed);
  if (parsed && typeof parsed === "object") {
    return outputContainerText(parsed as { type?: unknown; value?: unknown });
  }
  return null;
}

function extractedOutputText(output: string | null | undefined): string | null {
  if (typeof output !== "string" || output.trim().length === 0) return null;
  const raw = output.trim();
  if (!raw.startsWith("{") && !raw.startsWith("[")) return raw;
  try {
    return parsedOutputText(JSON.parse(raw));
  } catch {
    return raw;
  }
}

/**
 * Everything the agent was told before the user's own words, out of a span's
 * serialized chat input (`{type:"chat_messages",value:[{role,content},...]}`,
 * how the claude read-time enrichment writes the request body's conversation
 * onto the llm_request span).
 *
 * Two sources, because claude uses both. A `system` turn carries the top-level
 * system prompt and the tool definitions. The rest, the CLAUDE.md files, the
 * skills preamble, the MCP inventory, rides `<system-reminder>` blocks stapled
 * to the FIRST user message, so a session whose top-level system field never
 * reached telemetry (claude cuts the body at 60KB, and the system field
 * serializes after the message history) still shows what filled the window.
 */
/** The system-text parts accumulated across a chat's messages, in order. */
interface SystemTextAccumulator {
  parts: string[];
  firstUserReminders: string | null;
}

function collectSystemTextFromMessage(
  message: unknown,
  acc: SystemTextAccumulator,
): void {
  const m = message as { role?: unknown; content?: unknown } | null;
  if (typeof m?.content !== "string" || m.content.length === 0) return;
  if (m.role === "system") {
    acc.parts.push(m.content);
  } else if (m.role === "user" && acc.firstUserReminders === null) {
    acc.firstUserReminders = systemReminderText(m.content);
  }
}

function extractedSystemText(input: string | null | undefined): string | null {
  const messages = parsedChatMessages(input);
  if (messages === null) return null;

  const acc: SystemTextAccumulator = { parts: [], firstUserReminders: null };
  for (const message of messages) {
    collectSystemTextFromMessage(message, acc);
  }
  if (acc.firstUserReminders !== null) acc.parts.push(acc.firstUserReminders);
  return acc.parts.length > 0 ? acc.parts.join("\n\n") : null;
}

/**
 * The message list out of a serialized chat input. The read path serializes it
 * as the bare message ARRAY (`buildDisplayInput` -> `JSON.stringify(io.value)`)
 * while the `{type, value}` wrapper is the in-process shape; both are accepted
 * so a caller reads the same input whichever side hands it over.
 */
function parsedChatMessages(
  input: string | null | undefined,
): unknown[] | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw.startsWith("[") && !raw.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;
  const wrapper = parsed as { type?: unknown; value?: unknown };
  if (wrapper.type !== "chat_messages" || !Array.isArray(wrapper.value)) {
    return null;
  }
  return wrapper.value;
}

/**
 * The `<system-reminder>` blocks out of a user message, concatenated. This is
 * the envelope claude wraps injected context in, and the only thing that
 * separates it from what the user actually typed.
 */
function systemReminderText(content: string): string | null {
  const blocks = content.match(
    /<system-reminder>[\s\S]*?(?:<\/system-reminder>|$)/g,
  );
  if (blocks === null || blocks.length === 0) return null;
  const text = blocks.join("\n\n").trim();
  return text.length > 0 ? text : null;
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
function isAssistantLikeRole(role: unknown): boolean {
  return role === undefined || role === "assistant" || role === "model";
}

/** Gemini's `parts` shape: `thought: true` marks thinking, filtered by {@link isReplyTextPart}. */
function textFromParts(parts: unknown[]): string | null {
  const texts: string[] = [];
  for (const part of parts) {
    const p = part as { text?: unknown; thought?: unknown };
    if (isReplyTextPart(p)) texts.push(p.text);
  }
  return texts.length > 0 ? texts.join("\n") : null;
}

/** The `content` array shape: only untagged/`text`/`output_text` parts are the reply. */
function textFromContentParts(content: unknown[]): string | null {
  const texts: string[] = [];
  for (const part of content) {
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
  return texts.length > 0 ? texts.join("\n") : null;
}

function replyTextFromMessage(message: unknown): string | null {
  const m = message as {
    role?: unknown;
    content?: unknown;
    parts?: unknown;
  } | null;
  if (!m) return null;
  if (!isAssistantLikeRole(m.role)) return null;
  if (typeof m.content === "string" && m.content.length > 0) return m.content;
  if (Array.isArray(m.parts)) {
    const fromParts = textFromParts(m.parts);
    if (fromParts !== null) return fromParts;
  }
  if (Array.isArray(m.content)) return textFromContentParts(m.content);
  return null;
}

function messagesReplyText(messages: unknown[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = replyTextFromMessage(messages[i]);
    if (text !== null) return text;
  }
  return null;
}

/**
 * The final answer out of gemini's `response_text` payload: a JSON
 * candidates array (or single candidates object) whose parts mix thinking
 * (`thought: true`), empty thoughtSignature padding, and the actual reply.
 * Only untagged, non-empty text parts are the reply.
 */
function pushGeminiPartsText(parts: unknown[], texts: string[]): void {
  for (const part of parts) {
    const p = part as { text?: unknown; thought?: unknown };
    if (isReplyTextPart(p)) texts.push(p.text);
  }
}

function pushGeminiCandidatesText(
  candidates: unknown[],
  texts: string[],
): void {
  for (const candidate of candidates) {
    const parts = (candidate as { content?: { parts?: unknown } })?.content
      ?.parts;
    if (!Array.isArray(parts)) continue;
    pushGeminiPartsText(parts, texts);
  }
}

function pushGeminiRootText(root: unknown, texts: string[]): void {
  const candidates = (root as { candidates?: unknown })?.candidates;
  if (!Array.isArray(candidates)) return;
  pushGeminiCandidatesText(candidates, texts);
}

function geminiResponseText(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const roots = Array.isArray(parsed) ? parsed : [parsed];
    const texts: string[] = [];
    for (const root of roots) {
      pushGeminiRootText(root, texts);
    }
    return texts.length > 0 ? texts.join("\n") : null;
  } catch {
    return raw;
  }
}
