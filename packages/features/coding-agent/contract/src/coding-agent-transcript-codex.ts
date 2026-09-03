import type { SpanDetail } from "@langwatch/trace-contract";
import { emitSystemPrompt } from "./coding-agent-transcript-state";
import { isInjectedContextOnly } from "./coding-agent-transcript-context";
import {
  extractedOutputText,
  extractedSystemText,
  isSameRecoveredReply,
  parsedChatMessages,
} from "./coding-agent-transcript-content";
import type { RenderedToolCall, SpanEntryAccumulator } from "./coding-agent-transcript-state";
import { modelOf } from "./coding-agent-transcript-value";

export const CODEX_RECOVERED_CONTENT_SPAN_NAME = "codex.turn.response";

interface RecoveredMessage {
  role?: unknown;
  content?: unknown;
  tool_call_id?: unknown;
  tool_calls?: {
    id?: unknown;
    function?: { name?: unknown; arguments?: unknown };
  }[];
}

export function collectRecoveredCodexTurn(
  span: SpanDetail,
  accumulator: SpanEntryAccumulator,
): void {
  const messages = parsedChatMessages(span.input);
  emitSystemPrompt(span, accumulator);

  if (messages !== null) {
    const fresh = messages.slice(accumulator.recoveredMessageCount);
    accumulator.recoveredMessageCount = messages.length;
    replayRecoveredMessages({ messages: fresh, span, accumulator });
  }

  const replyText = extractedOutputText(span.output);
  if (replyText === null) return;

  accumulator.lastRecoveredReply = replyText;
  accumulator.spanReplies.push({
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

function replayRecoveredMessages({
  messages,
  span,
  accumulator,
}: {
  messages: unknown[];
  span: SpanDetail;
  accumulator: SpanEntryAccumulator;
}): void {
  const pending = new Map<string, RenderedToolCall>();

  for (const raw of messages) {
    const message = raw as RecoveredMessage | null;
    if (!message || typeof message !== "object") continue;

    const content = typeof message.content === "string" ? message.content : null;
    replayRecoveredMessage({ message, content, span, accumulator, pending });
  }
}

function replayRecoveredMessage({
  message,
  content,
  span,
  accumulator,
  pending,
}: {
  message: RecoveredMessage;
  content: string | null;
  span: SpanDetail;
  accumulator: SpanEntryAccumulator;
  pending: Map<string, RenderedToolCall>;
}): void {
  switch (message.role) {
    case "user":
      replayUserMessage({ content, span, accumulator });
      break;
    case "tool":
      attachToolResult({ message, content, pending });
      break;
    case "assistant":
      replayAssistantMessage({ message, content, span, accumulator, pending });
      break;
  }
}

function replayUserMessage({
  content,
  span,
  accumulator,
}: {
  content: string | null;
  span: SpanDetail;
  accumulator: SpanEntryAccumulator;
}): void {
  if (content === null || content.length === 0 || isInjectedContextOnly(content)) return;

  accumulator.entries.push({
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
  pending: Map<string, RenderedToolCall>;
}): void {
  const id = typeof message.tool_call_id === "string" ? message.tool_call_id : null;
  const entry = id === null ? null : pending.get(id);
  if (entry) entry.output = content;
}

function replayAssistantMessage({
  message,
  content,
  span,
  accumulator,
  pending,
}: {
  message: RecoveredMessage;
  content: string | null;
  span: SpanDetail;
  accumulator: SpanEntryAccumulator;
  pending: Map<string, RenderedToolCall>;
}): void {
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const [index, call] of calls.entries()) {
    replayToolCall({
      call,
      turnLocalId: `${span.spanId}-${index}`,
      span,
      accumulator,
      pending,
    });
  }

  if (content === null || content.length === 0) return;
  if (isSameRecoveredReply(content, accumulator.lastRecoveredReply)) return;

  accumulator.entries.push({
    kind: "assistant_message",
    atMs: span.startTimeMs,
    text: content,
    model: modelOf(span),
  });
}

function replayToolCall({
  call,
  turnLocalId,
  span,
  accumulator,
  pending,
}: {
  call: NonNullable<RecoveredMessage["tool_calls"]>[number] | undefined;
  turnLocalId: string;
  span: SpanDetail;
  accumulator: SpanEntryAccumulator;
  pending: Map<string, RenderedToolCall>;
}): void {
  const callId = typeof call?.id === "string" ? call.id : null;
  if (callId !== null && accumulator.claimedToolCalls.has(callId)) return;

  const entry: RenderedToolCall = {
    kind: "tool",
    atMs: span.startTimeMs,
    name: typeof call?.function?.name === "string" ? call.function.name : "tool",
    mcpServer: null,
    input: call?.function?.arguments ?? null,
    output: null,
    durationMs: null,
    failed: false,
    agentId: null,
    spanId: span.spanId,
  };

  if (callId !== null) accumulator.claimedToolCalls.set(callId, entry);
  pending.set(callId ?? turnLocalId, entry);
  accumulator.totals.toolCalls += 1;
  accumulator.entries.push(entry);
}
