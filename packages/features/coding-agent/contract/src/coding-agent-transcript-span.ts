import { isModelCallSpan } from "./telemetry";
import {
  parseMcpToolName,
  resolveToolName,
} from "./telemetry/coding-agent-normalization";
import type { SpanDetail } from "@langwatch/trace-contract";
import {
  CODEX_RECOVERED_CONTENT_SPAN_NAME,
  collectRecoveredCodexTurn,
} from "./coding-agent-transcript-codex";
import {
  extractedOutputText,
  extractedSystemText,
  outputMessagesText,
} from "./coding-agent-transcript-content";
import {
  type CodexToolLogContent,
  type SpanEntryAccumulator,
  createSpanEntryAccumulator,
  fillToolCallGaps,
} from "./coding-agent-transcript-state";
import { modelOf, readNumber, readString } from "./coding-agent-transcript-value";

export function collectSpanEntries(
  spans: SpanDetail[],
  codexToolLogs: Map<string, CodexToolLogContent>,
): SpanEntryAccumulator {
  const accumulator = createSpanEntryAccumulator();
  const hasCodexTurnRollup = spans.some((span) => span.name === "session_task.turn");
  collectRecoveredTurns(spans, accumulator);

  for (const span of spans) {
    if (span.name === CODEX_RECOVERED_CONTENT_SPAN_NAME) continue;

    const isCodexResponseCall =
      !hasCodexTurnRollup &&
      span.name === "handle_responses" &&
      readNumber(span.params, "gen_ai.usage.input_tokens") !== null;

    if (isModelCallSpan(span.name) || isCodexResponseCall) {
      collectModelCallSpan(span, accumulator);
    } else {
      collectToolSpan(span, accumulator, codexToolLogs);
    }
  }

  return accumulator;
}

function collectRecoveredTurns(
  spans: SpanDetail[],
  accumulator: SpanEntryAccumulator,
): void {
  const recovered = spans
    .filter((span) => span.name === CODEX_RECOVERED_CONTENT_SPAN_NAME)
    .sort((left, right) => left.startTimeMs - right.startTimeMs);

  for (const span of recovered) collectRecoveredCodexTurn(span, accumulator);
}

function collectModelCallSpan(span: SpanDetail, accumulator: SpanEntryAccumulator): void {
  const call = modelCallEntry(span);
  accumulator.totals.modelCalls += 1;
  accumulator.totals.tokens += call.tokens;
  accumulator.totals.costUsd += call.costUsd;
  accumulator.entries.push(call);

  emitSystemPrompt(span, accumulator);

  const replyText =
    extractedOutputText(span.output) ??
    outputMessagesText(readString(span.params, "gen_ai.output.messages"));
  if (replyText === null) return;

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

function emitSystemPrompt(span: SpanDetail, accumulator: SpanEntryAccumulator): void {
  if (accumulator.hasEmittedSystemPrompt) return;

  const systemText = extractedSystemText(span.input);
  if (systemText === null) return;

  accumulator.hasEmittedSystemPrompt = true;
  accumulator.entries.push({
    kind: "system_prompt",
    atMs: span.startTimeMs,
    text: systemText,
    chars: systemText.length,
  });
}

function collectToolSpan(
  span: SpanDetail,
  accumulator: SpanEntryAccumulator,
  codexToolLogs: Map<string, CodexToolLogContent>,
): void {
  const toolName = resolveToolName({
    spanName: span.name,
    attrs: (span.params ?? {}) as Record<string, unknown>,
  });
  if (toolName === null) return;

  const callId = readString(span.params, "call_id");
  const logContent = callId !== null ? codexToolLogs.get(callId) : void 0;
  const failed =
    span.status === "error" || span.error != null || (logContent?.failed ?? false);
  const claimed = callId !== null ? accumulator.claimedToolCalls.get(callId) : void 0;

  if (claimed !== void 0) {
    fillToolCallGaps(claimed, { durationMs: spanDurationMs(span), failed });
    return;
  }

  accumulator.totals.toolCalls += 1;
  const agentId = readString(span.params, "agent_id");
  countSubAgentTool(agentId, accumulator);

  const entry = {
    kind: "tool" as const,
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

  if (callId !== null) accumulator.claimedToolCalls.set(callId, entry);
  accumulator.entries.push(entry);
}

function countSubAgentTool(
  agentId: string | null,
  accumulator: SpanEntryAccumulator,
): void {
  if (agentId === null) return;

  const count = accumulator.subAgentToolCounts.get(agentId) ?? 0;
  accumulator.subAgentToolCounts.set(agentId, count + 1);
}

function spanDurationMs(span: SpanDetail): number | null {
  return span.endTimeMs && span.startTimeMs ? span.endTimeMs - span.startTimeMs : null;
}

function modelCallEntry(span: SpanDetail) {
  const inputTokens = inputTokensOf(span);
  const outputTokens = outputTokensOf(span);
  const metricTokens =
    (span.metrics?.promptTokens ?? 0) + (span.metrics?.completionTokens ?? 0);
  const reportedTotal = readNumber(span.params, "codex.turn.token_usage.total_tokens");
  const tokens =
    metricTokens > 0 ? metricTokens : (reportedTotal ?? inputTokens + outputTokens);

  return {
    kind: "model_call" as const,
    atMs: span.startTimeMs,
    model: modelOf(span),
    tokens,
    costUsd: span.metrics?.cost ?? 0,
    durationMs: spanDurationMs(span),
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
      readNumber(span.params, "gen_ai.usage.cache_write.input_tokens") ??
      readNumber(span.params, "codex.turn.token_usage.cache_write_input_tokens") ??
      0,
  };
}

function inputTokensOf(span: SpanDetail): number {
  return (
    readNumber(span.params, "input_tokens") ??
    readNumber(span.params, "gen_ai.usage.input_tokens") ??
    readNumber(span.params, "ai.usage.inputTokens") ??
    readNumber(span.params, "codex.turn.token_usage.non_cached_input_tokens") ??
    0
  );
}

function outputTokensOf(span: SpanDetail): number {
  return (
    readNumber(span.params, "output_tokens") ??
    readNumber(span.params, "gen_ai.usage.output_tokens") ??
    readNumber(span.params, "ai.usage.outputTokens") ??
    readNumber(span.params, "codex.turn.token_usage.output_tokens") ??
    0
  );
}
