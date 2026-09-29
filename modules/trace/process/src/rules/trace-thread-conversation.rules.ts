import type { Span, Trace } from "@langwatch/trace-contract";
import {
  buildParsedTurns,
  type ConversationTurnSource,
  type ConversationView,
  type RenderedConversationMarkdown,
  renderConversationMarkdown,
} from "@langwatch/trace-contract/conversation";
import { extractReadableText } from "@langwatch/trace-contract/transcript";

import { extractConversationSteps } from "./trace-conversation-steps.rules.ts";
import { extractLlmMessagesForTrace } from "./trace-llm-messages.rules.ts";

/**
 * A thread as the one transcript a reader that is a model gets: every turn
 * once, in the order given, with its steps, shortened to the budget when one
 * is given. The drawer's copy, LangWatchQL and evaluators all read this.
 */
export function renderThreadConversation({
  threadKey,
  traces,
  maxTokens,
  view,
}: {
  threadKey: string;
  traces: readonly Trace[];
  maxTokens?: number;
  view: ConversationView;
}): RenderedConversationMarkdown {
  return renderConversationMarkdown({
    conversationId: threadKey,
    turns: buildParsedTurns({ turns: traces.map((trace) => traceToConversationTurn({ trace })) }),
    view,
    ...(maxTokens === undefined ? {} : { maxTokens }),
  });
}

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

  const turnOutput = output !== "" ? output : toMessagesJson(fallback?.output);
  const steps = extractConversationSteps({
    spans,
    replyText: extractReadableText(turnOutput, "assistant"),
  });
  return {
    traceId: trace.trace_id,
    timestamp: trace.timestamps.started_at,
    durationMs: trace.metrics?.total_time_ms ?? 0,
    models: modelsOf(spans),
    totalCost: trace.metrics?.total_cost ?? null,
    totalTokens: tokensOf(trace),
    input: input !== "" ? input : toMessagesJson(fallback?.input),
    output: turnOutput,
    ...(trace.error?.message ? { error: trace.error.message } : {}),
    ...(steps.length > 0 ? { steps } : {}),
  };
}

/**
 * The models an LLM span of this trace reported, the one that wrote the most
 * output first: a coding agent's first call is often a title call on a small
 * model, not the model that did the work.
 */
function modelsOf(spans: readonly Span[]): string[] {
  const outputTokens = new Map<string, number>();
  for (const span of spans) {
    const model = "model" in span ? span.model : null;
    if (typeof model !== "string" || model === "") continue;
    const written = span.metrics?.completion_tokens ?? 0;
    outputTokens.set(model, (outputTokens.get(model) ?? 0) + written);
  }
  return [...outputTokens.entries()]
    .map(([model, written], firstSeen) => ({ model, written, firstSeen }))
    .toSorted((a, b) => b.written - a.written || a.firstSeen - b.firstSeen)
    .map(({ model }) => model);
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
