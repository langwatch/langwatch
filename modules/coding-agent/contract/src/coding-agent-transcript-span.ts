import type { SpanDetail } from "@langwatch/trace-contract";

import {
  CODEX_RECOVERED_CONTENT_SPAN_NAME,
  collectRecoveredCodexTurn,
} from "./coding-agent-transcript-codex.ts";
import { extractOutputText, extractOutputMessagesText } from "./coding-agent-transcript-content.ts";
import {
  type CodexToolLogContent,
  createSpanEntryAccumulator,
  emitSystemPrompt,
  fillToolCallGaps,
  type SpanEntryAccumulator,
} from "./coding-agent-transcript-state.ts";
import { pickModel, pickNumber, pickString } from "./coding-agent-transcript-value.ts";
import { parseMcpToolName, deriveToolName } from "./telemetry/coding-agent-normalization.ts";
import { isModelCallSpan } from "./telemetry/index.ts";

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
      pickNumber(span.params, "gen_ai.usage.input_tokens") !== null;

    if (isModelCallSpan(span.name) || isCodexResponseCall) {
      collectModelCallSpan(span, accumulator);
    } else {
      collectToolSpan(span, accumulator, codexToolLogs);
    }
  }

  return accumulator;
}

function collectRecoveredTurns(spans: SpanDetail[], accumulator: SpanEntryAccumulator): void {
  const recovered = spans
    .filter((span) => span.name === CODEX_RECOVERED_CONTENT_SPAN_NAME)
    .toSorted((left, right) => left.startTimeMs - right.startTimeMs);

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
    extractOutputText(span.output) ??
    extractOutputMessagesText(pickString(span.params, "gen_ai.output.messages"));
  if (replyText === null) return;

  accumulator.spanReplies.push({
    entry: {
      kind: "assistant_message",
      atMs: span.endTimeMs ?? span.startTimeMs,
      text: replyText,
      model: pickModel(span),
    },
    windowStartMs: span.startTimeMs,
    windowEndMs: span.endTimeMs ?? span.startTimeMs,
  });
}

function collectToolSpan(
  span: SpanDetail,
  accumulator: SpanEntryAccumulator,
  codexToolLogs: Map<string, CodexToolLogContent>,
): void {
  const toolName = deriveToolName({
    spanName: span.name,
    attrs: (span.params ?? {}) as Record<string, unknown>,
  });
  if (toolName === null) return;

  const callId = pickString(span.params, "call_id");
  const logContent = callId !== null ? codexToolLogs.get(callId) : void 0;
  const failed = span.status === "error" || span.error != null || (logContent?.failed ?? false);
  const claimed = callId !== null ? accumulator.claimedToolCalls.get(callId) : void 0;

  if (claimed !== void 0) {
    fillToolCallGaps(claimed, { durationMs: computeSpanDurationMs(span), failed });
    return;
  }

  accumulator.totals.toolCalls += 1;
  const agentId = pickString(span.params, "agent_id");
  countSubAgentTool(agentId, accumulator);

  const entry = {
    kind: "tool" as const,
    atMs: span.startTimeMs,
    name: toolName,
    mcpServer: parseMcpToolName(toolName)?.server ?? null,
    input: span.input ?? logContent?.input ?? null,
    output: span.output ?? logContent?.output ?? null,
    durationMs: computeSpanDurationMs(span),
    failed,
    agentId,
    spanId: span.spanId,
  };

  if (callId !== null) accumulator.claimedToolCalls.set(callId, entry);
  accumulator.entries.push(entry);
}

function countSubAgentTool(agentId: string | null, accumulator: SpanEntryAccumulator): void {
  if (agentId === null) return;

  const count = accumulator.subAgentToolCounts.get(agentId) ?? 0;
  accumulator.subAgentToolCounts.set(agentId, count + 1);
}

function computeSpanDurationMs(span: SpanDetail): number | null {
  return span.endTimeMs && span.startTimeMs ? span.endTimeMs - span.startTimeMs : null;
}

function modelCallEntry(span: SpanDetail): {
  kind: "model_call";
  atMs: number;
  model: string | null;
  tokens: number;
  costUsd: number;
  durationMs: number | null;
  spanId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
} {
  const inputTokens = inputTokensOf(span);
  const outputTokens = outputTokensOf(span);
  const metricTokens = (span.metrics?.promptTokens ?? 0) + (span.metrics?.completionTokens ?? 0);
  const reportedTotal = pickNumber(span.params, "codex.turn.token_usage.total_tokens");
  const tokens = metricTokens > 0 ? metricTokens : (reportedTotal ?? inputTokens + outputTokens);

  return {
    kind: "model_call" as const,
    atMs: span.startTimeMs,
    model: pickModel(span),
    tokens,
    costUsd: span.metrics?.cost ?? 0,
    durationMs: computeSpanDurationMs(span),
    spanId: span.spanId,
    inputTokens,
    outputTokens,
    cacheReadTokens:
      pickNumber(span.params, "cache_read_tokens") ??
      pickNumber(span.params, "gen_ai.usage.cache_read.input_tokens") ??
      0,
    cacheCreationTokens:
      pickNumber(span.params, "cache_creation_tokens") ??
      pickNumber(span.params, "gen_ai.usage.cache_creation.input_tokens") ??
      pickNumber(span.params, "gen_ai.usage.cache_write.input_tokens") ??
      pickNumber(span.params, "codex.turn.token_usage.cache_write_input_tokens") ??
      0,
  };
}

function inputTokensOf(span: SpanDetail): number {
  return (
    pickNumber(span.params, "input_tokens") ??
    pickNumber(span.params, "gen_ai.usage.input_tokens") ??
    pickNumber(span.params, "ai.usage.inputTokens") ??
    pickNumber(span.params, "codex.turn.token_usage.non_cached_input_tokens") ??
    0
  );
}

function outputTokensOf(span: SpanDetail): number {
  return (
    pickNumber(span.params, "output_tokens") ??
    pickNumber(span.params, "gen_ai.usage.output_tokens") ??
    pickNumber(span.params, "ai.usage.outputTokens") ??
    pickNumber(span.params, "codex.turn.token_usage.output_tokens") ??
    0
  );
}
