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

/**
 * The span the codex harvest writes the recovered conversation onto. Codex's
 * own telemetry carries no content, so this is the only span in a codex trace
 * that has anything to read.
 */
const CODEX_RECOVERED_CONTENT_SPAN_NAME = "codex.turn.response";

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
  // A codex tool run is recorded three times over: inside the conversation
  // recovered onto `codex.turn.response`, on a span carrying the tool's
  // identity and timing but no content, and on a `tool_result` log carrying
  // the arguments and output. All three name the same `call_id`, which is
  // what the passes below join on: the first to reach a call renders and
  // counts it, the later ones only fill in what they alone measured. Index
  // the logs first so a tool span can be filled from its log. Codex tool
  // spans normally never reach storage (the ingest noise filter drops them,
  // since codex gives them a parent in another trace), so in practice the
  // recovered conversation and the log side do the work, but the join keeps
  // traces stored before that filter, and any run with the filter's
  // kill-switch set, from rendering every tool call three times.
  const codexToolLogs = indexCodexToolLogsByCallId(logs);
  const fromSpans = collectSpanEntries(spans, codexToolLogs);
  const fromLogs = collectLogEntries(logs, fromSpans.claimedToolCalls);

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

/** One tool run, as the pass that reached it first rendered it. */
type RenderedToolCall = Extract<TranscriptEntry, { kind: "tool" }>;

/**
 * The tool entry standing for each `call_id` seen so far. Codex describes one
 * run three times over, so this is what makes the three agree on a single
 * entry: whichever pass reaches a call first renders and counts it, and the
 * later ones find it here and fill in what only they carry.
 */
type ClaimedToolCalls = Map<string, RenderedToolCall>;

/**
 * Add to an already-rendered call what a later signal measured and the pass
 * that rendered it could not know. Gaps only: the recovered conversation
 * carries a call's arguments and result but never its timing, and a run is
 * failed the moment any signal says it is.
 */
function fillToolCallGaps(
  entry: RenderedToolCall,
  measured: { durationMs: number | null; failed: boolean },
): void {
  if (entry.durationMs === null) entry.durationMs = measured.durationMs;
  if (measured.failed) entry.failed = true;
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
  claimedToolCalls: ClaimedToolCalls;
  /** The session's system context is emitted once, off the first call carrying one. */
  hasEmittedSystemPrompt: boolean;
  /**
   * How many messages of the recovered codex conversation have already been
   * turned into entries. Each turn re-sends the whole history, so only the
   * tail past this is new.
   */
  recoveredMessageCount: number;
  /** The previous recovered turn's reply, which opens the next turn's input. */
  lastRecoveredReply: string | null;
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
    claimedToolCalls: new Map(),
    hasEmittedSystemPrompt: false,
    recoveredMessageCount: 0,
    lastRecoveredReply: null,
  };

  // codex 0.146's exec wire has no `session_task.turn` rollup, its
  // usage-bearing `handle_responses` spans are the model calls. When the
  // rollup IS present (the TUI wire), those same spans are its per-response
  // parts and counting both would double every call.
  const hasCodexTurnRollup = spans.some(
    (span) => span.name === "session_task.turn",
  );

  // Codex's conversation is recovered from its session transcript and sent
  // back on the same trace, since its own telemetry carries no content. Each
  // recovered turn re-sends the whole history, so replaying them means taking
  // the tail past the previous turn — which only means anything in turn order.
  // Spans arrive in whatever order their exporter batched them (this function's
  // caller sorts by time only afterwards), so they are ordered here first.
  const recovered = spans
    .filter((span) => span.name === CODEX_RECOVERED_CONTENT_SPAN_NAME)
    .sort((a, b) => a.startTimeMs - b.startTimeMs);
  for (const span of recovered) {
    collectRecoveredCodexTurn(span, acc);
  }

  for (const span of spans) {
    // Already replayed above, in turn order. It deliberately does NOT count as
    // a model call: codex's own token-bearing spans already did, and counting
    // both would double every call in the totals.
    if (span.name === CODEX_RECOVERED_CONTENT_SPAN_NAME) continue;
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

/**
 * Replay one recovered codex turn into transcript entries.
 *
 * Each turn's recovered input is the WHOLE conversation as sent to the model,
 * so consecutive turns overlap almost entirely. Only the tail past what the
 * previous turn already contributed is emitted, or a three-turn session would
 * render its first prompt three times.
 *
 * The turn's own final reply is not in that input — the transcript records it
 * after the snapshot — so it rides `span.output` like every other agent whose
 * reply lands on the span. That does mean the NEXT turn's input opens with it,
 * which is why an opening assistant message repeating the previous reply is
 * dropped rather than emitted twice.
 */
function collectRecoveredCodexTurn(
  span: SpanDetail,
  acc: SpanEntryAccumulator,
): void {
  const messages = parsedChatMessages(span.input);

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

  if (messages !== null) {
    const fresh = messages.slice(acc.recoveredMessageCount);
    acc.recoveredMessageCount = messages.length;
    replayRecoveredMessages({ messages: fresh, span, acc });
  }

  const replyText = extractedOutputText(span.output);
  if (replyText === null) return;
  acc.lastRecoveredReply = replyText;
  acc.spanReplies.push({
    entry: {
      kind: "assistant_message",
      atMs: span.endTimeMs ?? span.startTimeMs,
      text: replyText,
      model: modelOf(span),
    },
    windowStartMs: span.startTimeMs,
    windowEndMs: span.endTimeMs ?? span.startTimeMs,
  });
}

/** One chat message off a recovered turn, in the shape the harvest writes. */
interface RecoveredMessage {
  role?: unknown;
  content?: unknown;
  tool_call_id?: unknown;
  tool_calls?: {
    id?: unknown;
    function?: { name?: unknown; arguments?: unknown };
  }[];
}

function replayRecoveredMessages({
  messages,
  span,
  acc,
}: {
  messages: unknown[];
  span: SpanDetail;
  acc: SpanEntryAccumulator;
}): void {
  // A tool call and its result are two separate messages paired by id; the
  // transcript wants them as one entry, so the call is held until its result
  // arrives (and still emitted, output-less, if it never does).
  const pending = new Map<string, Extract<TranscriptEntry, { kind: "tool" }>>();

  for (const raw of messages) {
    const message = raw as RecoveredMessage | null;
    if (!message || typeof message !== "object") continue;
    const content =
      typeof message.content === "string" ? message.content : null;

    switch (message.role) {
      case "user":
        replayUserMessage({ content, span, acc });
        break;
      case "tool":
        attachToolResult({ message, content, pending });
        break;
      case "assistant":
        replayAssistantMessage({ message, content, span, acc, pending });
        break;
    }
  }
}

function replayUserMessage({
  content,
  span,
  acc,
}: {
  content: string | null;
  span: SpanDetail;
  acc: SpanEntryAccumulator;
}): void {
  if (content === null || content.length === 0) return;
  // Already folded into the session context by extractedSystemText.
  if (isInjectedContextOnly(content)) return;
  acc.entries.push({
    kind: "user_prompt",
    atMs: span.startTimeMs,
    text: content,
    chars: content.length,
  });
}

function attachToolResult({
  message,
  content,
  pending,
}: {
  message: RecoveredMessage;
  content: string | null;
  pending: Map<string, Extract<TranscriptEntry, { kind: "tool" }>>;
}): void {
  const id =
    typeof message.tool_call_id === "string" ? message.tool_call_id : null;
  const entry = id === null ? null : pending.get(id);
  if (entry) entry.output = content;
}

/**
 * Render one tool call out of the recovered conversation.
 *
 * The ids here are codex's own `call_id`s, the same ones its tool spans and its
 * tool_result logs carry, so a run another pass already rendered is left to
 * that pass rather than becoming a second entry and a second tool count. A call
 * codex sent without an id can be joined on nothing, so it always renders, and
 * the turn-local key only has to pair it with its result inside this turn.
 */
function replayToolCall({
  call,
  turnLocalId,
  span,
  acc,
  pending,
}: {
  call: NonNullable<RecoveredMessage["tool_calls"]>[number] | undefined;
  turnLocalId: string;
  span: SpanDetail;
  acc: SpanEntryAccumulator;
  pending: Map<string, RenderedToolCall>;
}): void {
  const callId = typeof call?.id === "string" ? call.id : null;
  if (callId !== null && acc.claimedToolCalls.has(callId)) return;
  const entry: RenderedToolCall = {
    kind: "tool",
    atMs: span.startTimeMs,
    name:
      typeof call?.function?.name === "string" ? call.function.name : "tool",
    mcpServer: null,
    input: call?.function?.arguments ?? null,
    output: null,
    durationMs: null,
    failed: false,
    agentId: null,
    spanId: span.spanId,
  };
  if (callId !== null) acc.claimedToolCalls.set(callId, entry);
  pending.set(callId ?? turnLocalId, entry);
  acc.totals.toolCalls += 1;
  acc.entries.push(entry);
}

function replayAssistantMessage({
  message,
  content,
  span,
  acc,
  pending,
}: {
  message: RecoveredMessage;
  content: string | null;
  span: SpanDetail;
  acc: SpanEntryAccumulator;
  pending: Map<string, Extract<TranscriptEntry, { kind: "tool" }>>;
}): void {
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const [index, call] of calls.entries()) {
    replayToolCall({
      call,
      turnLocalId: `${span.spanId}-${index}`,
      span,
      acc,
      pending,
    });
  }

  // The previous turn's reply opens this turn's input; it was already emitted
  // off that turn's own output. Compared on a prefix rather than in full: the
  // producer caps what it writes to the span output but pushes the uncapped
  // text into the history, so a long reply is two different strings here and
  // an equality check would render it twice.
  if (content === null || content.length === 0) return;
  if (isSameRecoveredReply(content, acc.lastRecoveredReply)) return;
  acc.entries.push({
    kind: "assistant_message",
    atMs: span.startTimeMs,
    text: content,
    model: modelOf(span),
  });
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

  // A codex tool span records the run but not its content, that rides the
  // tool_result log sharing the span's call_id. When the recovered
  // conversation already rendered this call, the span is the only signal that
  // measured how long it took and whether it failed, so it hands those over
  // rather than repeating the call.
  const callId = readString(span.params, "call_id");
  const logContent = callId !== null ? codexToolLogs.get(callId) : undefined;
  // All three failure signals, because they are set independently: a span can
  // carry an error payload, or simply an error STATUS with no payload at all,
  // and the log reports the tool's own exit separately from either.
  const failed =
    span.status === "error" || span.error != null || isFailed(logContent);
  const claimed =
    callId !== null ? acc.claimedToolCalls.get(callId) : undefined;
  if (claimed !== undefined) {
    fillToolCallGaps(claimed, { durationMs: spanDurationMs(span), failed });
    return;
  }

  acc.totals.toolCalls += 1;

  const agentId = readString(span.params, "agent_id");
  countSubAgentTool(agentId, acc);

  const entry: RenderedToolCall = {
    kind: "tool",
    atMs: span.startTimeMs,
    name: toolName,
    mcpServer: parseMcpToolName(toolName)?.server ?? null,
    input: span.input ?? logContent?.input ?? null,
    output: span.output ?? logContent?.output ?? null,
    durationMs: spanDurationMs(span),
    failed,
    agentId,
    spanId: span.spanId,
  };
  if (callId !== null) acc.claimedToolCalls.set(callId, entry);
  acc.entries.push(entry);
}

/**
 * A sub-agent's tools are kept IN the sequence but marked, rather than hoisted
 * out of it. Dropping them lost the work entirely; flattening them into the
 * main thread pretended the main thread did it.
 */
function countSubAgentTool(
  agentId: string | null,
  acc: SpanEntryAccumulator,
): void {
  if (agentId === null) return;
  acc.subAgentToolCounts.set(
    agentId,
    (acc.subAgentToolCounts.get(agentId) ?? 0) + 1,
  );
}

function spanDurationMs(span: SpanDetail): number | null {
  return span.endTimeMs && span.startTimeMs
    ? span.endTimeMs - span.startTimeMs
    : null;
}

function isFailed(logContent: CodexToolLogContent | undefined): boolean {
  return logContent?.failed ?? false;
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
      // codex spells cache creation "cache_write", on both its span shapes.
      readNumber(span.params, "gen_ai.usage.cache_write.input_tokens") ??
      readNumber(
        span.params,
        "codex.turn.token_usage.cache_write_input_tokens",
      ) ??
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

function collectLogEntries(
  logs: TranscriptLogRecord[],
  claimedToolCalls: ClaimedToolCalls,
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

    const entry = logToEntry({ event, log, claimedToolCalls });
    if (entry !== null) entries.push(entry);
  }

  return { entries, sessionId };
}

function logToEntry({
  event,
  log,
  claimedToolCalls,
}: {
  event: string;
  log: TranscriptLogRecord;
  claimedToolCalls: ClaimedToolCalls;
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
      // codex tool_result logs (recognised by their call_id + arguments
      // shape) are the CONTENT record of a codex tool run. When an earlier
      // pass claimed the call_id, that entry already carries this log's
      // content and only wants the duration codex measured; unclaimed calls
      // (the model-facing harness call, MCP calls without spans, span-less
      // wires) render from the log alone.
      const callId = readString(attrs, "call_id");
      if (
        callId !== null &&
        readString(attrs, "event.name") === "codex.tool_result"
      ) {
        const claimed = claimedToolCalls.get(callId);
        if (claimed !== undefined) {
          fillToolCallGaps(claimed, {
            durationMs: readNumber(attrs, "duration_ms"),
            failed: readString(attrs, "success") === "false",
          });
          return null;
        }
        const codexToolName = readString(attrs, "tool_name");
        if (codexToolName === null) return null;
        const mcpServer = readString(attrs, "mcp_server");
        return {
          kind: "tool",
          atMs,
          name: codexToolName,
          mcpServer:
            mcpServer ?? parseMcpToolName(codexToolName)?.server ?? null,
          input: parseMaybeJson(readString(attrs, "arguments")),
          output: readString(attrs, "output"),
          durationMs: readNumber(attrs, "duration_ms"),
          failed: readString(attrs, "success") === "false",
          agentId: null,
          spanId: "",
        };
      }

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
function extractedSystemText(input: string | null | undefined): string | null {
  const messages = parsedChatMessages(input);
  if (messages === null) return null;

  const parts: string[] = [];
  let firstUserReminders: string | null = null;
  for (const message of messages) {
    const m = message as { role?: unknown; content?: unknown } | null;
    if (typeof m?.content !== "string" || m.content.length === 0) continue;
    if (m.role === "system") parts.push(m.content);
    else if (m.role === "user" && isInjectedContextOnly(m.content)) {
      // Context the agent injected under the user's name. It is part of what
      // the session pays for, not part of what the human asked.
      parts.push(m.content);
    } else if (m.role === "user" && firstUserReminders === null) {
      firstUserReminders = systemReminderText(m.content);
    }
  }
  if (firstUserReminders !== null) parts.push(firstUserReminders);
  return parts.length > 0 ? parts.join("\n\n") : null;
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
 * Longest message still considered for the injected-envelope test. Codex's
 * plugin and environment listing is a few KB; anything far past that is a human
 * pasting something, and is treated as their words.
 */
const MAX_INJECTED_CONTEXT_CHARS = 64_000;

/**
 * How much of a reply has to match for it to count as one already emitted. The
 * producer truncates the span output but not the copy it threads into the next
 * turn's history, so the two agree only on a prefix.
 */
const RECOVERED_REPLY_MATCH_CHARS = 200;

function isSameRecoveredReply(
  candidate: string,
  previous: string | null,
): boolean {
  if (previous === null) return false;
  if (candidate === previous) return true;
  const width = Math.min(
    RECOVERED_REPLY_MATCH_CHARS,
    candidate.length,
    previous.length,
  );
  if (width < RECOVERED_REPLY_MATCH_CHARS) return false;
  return candidate.slice(0, width) === previous.slice(0, width);
}

/**
 * Whether a "user" message is entirely context the agent injected, rather than
 * anything the human typed. Codex opens a session by sending its plugin
 * inventory and environment description as a user message; rendered as a
 * prompt, that buries the actual request under a wall of tool names.
 *
 * Structural rather than a list of known tag names, so a new envelope does not
 * silently start showing up as something the user said: strip the top-level
 * `<tag>…</tag>` blocks and see whether any prose survives. Claude's first user
 * message is unaffected — it carries `<system-reminder>` blocks AND the real
 * prompt, so prose remains and it is treated as a prompt, as before.
 */
function isInjectedContextOnly(content: string): boolean {
  const trimmed = content.trim();
  // An injected envelope always opens with its tag and is never the size of a
  // pasted file, so both checks fall out of what the shape actually is rather
  // than being arbitrary limits.
  if (!trimmed.startsWith("<")) return false;
  if (trimmed.length > MAX_INJECTED_CONTEXT_CHARS) return false;
  return strippedOfTagBlocks(trimmed).trim().length === 0;
}

/** The character classes a tag is spelled with: `<name.with-parts attrs>`. */
const TAG_NAME_START = /[A-Za-z_]/;
const TAG_NAME_CHAR = /[\w.-]/;
const TAG_ATTRIBUTE_LEAD = /\s/;

/** An opening tag: the name it pairs on, and where the block it opens starts. */
interface OpenTag {
  name: string;
  bodyStart: number;
}

/**
 * The next `>` at or after a position, remembered between lookups. Every `<`
 * nested inside an attribute list ends at the same `>` as the tag holding it,
 * and the scan only ever asks about positions further along, so one remembered
 * answer serves them all and the stretches actually scanned never overlap.
 */
interface TagEndScan {
  from: number;
  at: number;
}

function tagEndAtOrAfter(text: string, scan: TagEndScan, from: number): number {
  if (from < scan.from || (scan.at !== -1 && from > scan.at)) {
    scan.from = from;
    scan.at = text.indexOf(">", from);
  }
  return scan.at;
}

/**
 * Drop every `<tag>…</tag>` block from a message, in one forward pass.
 *
 * The scan walks `<` to `<`. At each one it reads an opening tag and pairs it
 * with the NEAREST `</name>` starting at or after that tag's body, dropping
 * everything between and resuming after the close. A `<` that opens nothing,
 * or opens a tag nothing ever closes, is kept and the scan moves on by one.
 * Nesting therefore falls out of the pairing rather than being tracked: an
 * inner block that closes before its parent is swallowed whole, and one that
 * closes after it is left behind, still visible in what survives.
 *
 * Close-tag positions are indexed by name up front and each name's index is
 * read forward only, so pairing costs nothing per attempt. That is what keeps
 * the walk linear in the message's length: an opening tag with no close
 * anywhere is a single lookup, not a scan to the end of the text, and prompts
 * routinely paste diffs, JSX and heredocs carrying thousands of them.
 */
function strippedOfTagBlocks(text: string): string {
  const closesByName = indexCloseTagPositions(text);
  const closeCursors = new Map<string, number>();
  const tagEnds: TagEndScan = { from: 0, at: text.indexOf(">") };

  const kept: string[] = [];
  let keptFrom = 0;
  let at = text.indexOf("<");
  while (at !== -1) {
    const open = readOpenTag(text, at, tagEnds);
    const closeAt =
      open === null
        ? null
        : closeTagAtOrAfter({
            closesByName,
            closeCursors,
            name: open.name,
            from: open.bodyStart,
          });
    if (open === null || closeAt === null) {
      at = text.indexOf("<", at + 1);
      continue;
    }
    kept.push(text.slice(keptFrom, at));
    keptFrom = closeAt + open.name.length + "</>".length;
    at = text.indexOf("<", keptFrom);
  }
  kept.push(text.slice(keptFrom));
  return kept.join("");
}

/**
 * Where the tag name starting at `from` ends, or `from` itself when no name
 * starts there. One spelling of the grammar, so an opening tag and the closing
 * tag it pairs with can never disagree about what a name is.
 */
function tagNameEnd(text: string, from: number): number {
  const first = text[from];
  if (first === undefined || !TAG_NAME_START.test(first)) return from;
  let cursor = from + 1;
  while (cursor < text.length && TAG_NAME_CHAR.test(text[cursor]!)) cursor += 1;
  return cursor;
}

/**
 * Where every `</name>` starts, by name, ascending. A closing tag is exactly
 * that: no attributes and no spaces, which is why indexing them needs no
 * forward scan of its own.
 */
function indexCloseTagPositions(text: string): Map<string, number[]> {
  const byName = new Map<string, number[]>();
  let at = text.indexOf("</");
  while (at !== -1) {
    const nameStart = at + "</".length;
    const nameEnd = tagNameEnd(text, nameStart);
    if (nameEnd > nameStart && text[nameEnd] === ">") {
      const name = text.slice(nameStart, nameEnd);
      const positions = byName.get(name);
      if (positions) positions.push(at);
      else byName.set(name, [at]);
    }
    at = text.indexOf("</", at + 1);
  }
  return byName;
}

/**
 * The opening tag at a `<`, if it is one. The name runs to the first character
 * that cannot be part of one; after it, `>` closes the tag and whitespace opens
 * an attribute list running to the tag's own `>`. Anything else means this `<`
 * opens nothing: `<a/>`, `< a>` and `<1a>` are ordinary text.
 */
function readOpenTag(
  text: string,
  at: number,
  tagEnds: TagEndScan,
): OpenTag | null {
  const nameStart = at + 1;
  const nameEnd = tagNameEnd(text, nameStart);
  if (nameEnd === nameStart) return null;
  const name = text.slice(nameStart, nameEnd);
  const after = text[nameEnd];
  if (after === ">") return { name, bodyStart: nameEnd + 1 };
  if (after === undefined || !TAG_ATTRIBUTE_LEAD.test(after)) return null;
  const end = tagEndAtOrAfter(text, tagEnds, nameEnd + 1);
  return end === -1 ? null : { name, bodyStart: end + 1 };
}

/**
 * The first `</name>` starting at or after a position. Bodies start further
 * along with every tag the scan opens, so each name's read head only moves
 * forward and the whole walk costs one pass over the index.
 */
function closeTagAtOrAfter({
  closesByName,
  closeCursors,
  name,
  from,
}: {
  closesByName: Map<string, number[]>;
  closeCursors: Map<string, number>;
  name: string;
  from: number;
}): number | null {
  const positions = closesByName.get(name);
  if (positions === undefined) return null;
  let cursor = closeCursors.get(name) ?? 0;
  while (cursor < positions.length && positions[cursor]! < from) cursor += 1;
  closeCursors.set(name, cursor);
  return positions[cursor] ?? null;
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
