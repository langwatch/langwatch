import type { Span, Trace } from "@langwatch/trace-contract";
import type { ConversationTurnSource } from "@langwatch/trace-contract/conversation";

import { extractLlmMessagesForTrace } from "./trace-llm-messages.rules.ts";

/**
 * A trace as one conversation turn. Captured text is empty on a large share of
 * production traces, so each side falls back on its own to the chosen LLM
 * span's messages — an input with an empty output is the common case.
 */
export function traceToConversationTurn({ trace }: { trace: Trace }): ConversationTurnSource {
  const input = trace.input?.value ?? "";
  const output = trace.output?.value ?? "";
  const spans = trace.spans ?? [];
  const fallback =
    input === "" || output === "" ? extractLlmMessagesForTrace({ trace, spans }) : null;

  return {
    traceId: trace.trace_id,
    timestamp: trace.timestamps.started_at,
    durationMs: trace.metrics?.total_time_ms ?? 0,
    models: modelsOf(spans),
    totalCost: trace.metrics?.total_cost ?? null,
    totalTokens: tokensOf(trace),
    input: input !== "" ? input : toMessagesJson(fallback?.input),
    output: output !== "" ? output : toMessagesJson(fallback?.output),
    ...(trace.error?.message ? { error: trace.error.message } : {}),
  };
}

/** The models an LLM span of this trace reported, in first-seen order. */
function modelsOf(spans: readonly Span[]): string[] {
  const models: string[] = [];
  for (const span of spans) {
    const model = "model" in span ? span.model : null;
    if (typeof model !== "string" || model === "") continue;
    if (!models.includes(model)) models.push(model);
  }
  return models;
}

function tokensOf(trace: Trace): number {
  const metrics = trace.metrics;
  return (metrics?.prompt_tokens ?? 0) + (metrics?.completion_tokens ?? 0);
}

/**
 * A message list as the JSON the transcript parser reads, empty when there is
 * none. Serialised back rather than rendered here, so this stays a source of
 * turns rather than a second renderer.
 */
function toMessagesJson(messages: readonly unknown[] | undefined): string {
  if (!messages || messages.length === 0) return "";
  return JSON.stringify(messages);
}
