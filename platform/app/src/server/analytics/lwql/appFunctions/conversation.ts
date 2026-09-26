/**
 * LangWatchQL app functions — the thread-keyed values.
 *
 * `conversation`, `conversation_bounded` and `thread_traces`, all three
 * computed from the same list of a thread's traces. The rendering itself is
 * the drawer's own (`~/shared/traces/conversation`), so what a query returns
 * and what a person reads in the product are the same text rather than two
 * renderings that drift.
 *
 * ## The fallback the production data forces
 *
 * `ComputedInput` / `ComputedOutput` — the trace-level text the conversation
 * view is built from — is empty on a third to nearly all traces for several
 * large tenants, and on most coding-agent traces. A transcript built from
 * those alone would come back as a list of empty turns, which reads as "the
 * conversation was empty" rather than "we looked in the wrong place". So each
 * side falls back, per turn, to the chat messages of the trace's chosen LLM
 * span. Per side rather than per turn as a whole, because a trace with a
 * captured input and an empty output is common and only the output needs
 * replacing.
 *
 * The chain ends there on purpose. The next tier — the whole span digest — is
 * `llm_readable_trace`, its own function with its own budget, and folding it in
 * here would make one function's output depend on which tier it silently
 * reached.
 *
 * @see ~/shared/traces/conversation/conversationMarkdownBounded.ts — the renderer
 * @see ./hydrate.ts
 */

import type { Span, Trace } from "~/server/tracer/types";
import { llmMessagesForTrace } from "~/server/traces/llmSpanMessages";
import { renderConversationMarkdown } from "~/shared/traces/conversation/conversationMarkdownBounded";
import {
  buildParsedTurns,
  type ConversationTurnSource,
} from "~/shared/traces/conversation/parsedTurns";

/** The models an LLM span of this trace reported, in first-seen order. */
function modelsOf(spans: readonly Span[]): string[] {
  const models: string[] = [];
  for (const span of spans) {
    const model = (span as { model?: unknown }).model;
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
 * One trace as a conversation turn.
 *
 * The turn's text is the trace's own captured input and output where it has
 * them, and the chosen LLM span's messages where it does not — serialised back
 * to JSON because that is a shape the transcript parser already reads, which
 * keeps this function a *source* of turns rather than a second renderer.
 */
export function traceToConversationTurn({
  trace,
}: {
  trace: Trace;
}): ConversationTurnSource {
  const input = trace.input?.value ?? "";
  const output = trace.output?.value ?? "";
  const spans = trace.spans ?? [];
  const fallback =
    input === "" || output === ""
      ? llmMessagesForTrace({ trace, spans })
      : null;

  return {
    traceId: trace.trace_id,
    timestamp: trace.timestamps.started_at,
    durationMs: trace.metrics?.total_time_ms ?? 0,
    models: modelsOf(spans),
    totalCost: trace.metrics?.total_cost ?? null,
    totalTokens: tokensOf(trace),
    input: input !== "" ? input : messagesJson(fallback?.input),
    output: output !== "" ? output : messagesJson(fallback?.output),
    ...(trace.error?.message ? { error: trace.error.message } : {}),
  };
}

/** A message list as the JSON the transcript parser reads, or null when empty. */
function messagesJson(messages: readonly unknown[] | undefined): string | null {
  if (!messages || messages.length === 0) return null;
  return JSON.stringify(messages);
}

/**
 * The thread's traces in the order they happened.
 *
 * Sorted here rather than trusted from the read: the value is a transcript, and
 * a transcript in the wrong order is wrong in a way no reader can detect. Ties
 * fall back to the trace id so two identical threads render identically.
 */
export function orderThreadTraces(traces: readonly Trace[]): Trace[] {
  return [...traces].sort((a, b) => {
    const byTime = a.timestamps.started_at - b.timestamps.started_at;
    if (byTime !== 0) return byTime;
    return a.trace_id.localeCompare(b.trace_id);
  });
}

/**
 * The thread's traces up to and including one of them.
 *
 * What it is for: judging a turn on what the agent had actually seen, rather
 * than on a conversation that continued afterwards. A trace id the thread does
 * not contain leaves the thread whole — the alternative, an empty transcript,
 * would read as "this thread has nothing in it" for what is really a mistyped
 * id, and the caller can see the id they passed.
 */
export function threadTracesUntil({
  traces,
  untilTraceId,
}: {
  traces: readonly Trace[];
  untilTraceId: string;
}): readonly Trace[] {
  if (untilTraceId === "") return traces;
  const cut = traces.findIndex((trace) => trace.trace_id === untilTraceId);
  return cut < 0 ? traces : traces.slice(0, cut + 1);
}

/** The thread's trace ids, oldest first — the `thread_traces` value. */
export function threadTraceIds({
  traces,
}: {
  traces: readonly Trace[];
}): string[] {
  return orderThreadTraces(traces).map((trace) => trace.trace_id);
}

/**
 * The thread as one markdown transcript, optionally under a token budget.
 *
 * With no budget this is the drawer's Copy output for the same thread. With
 * one, the renderer keeps the preamble and both ends and writes a marker naming
 * what it dropped, so a cut transcript can never be mistaken for a short
 * conversation.
 */
export function renderThreadConversation({
  threadKey,
  traces,
  maxTokens,
  untilTraceId = "",
}: {
  threadKey: string;
  traces: readonly Trace[];
  /** Absent for the unbounded `conversation`. */
  maxTokens?: number;
  untilTraceId?: string;
}): string {
  const ordered = threadTracesUntil({
    traces: orderThreadTraces(traces),
    untilTraceId,
  });
  const rendered = renderConversationMarkdown({
    conversationId: threadKey,
    turns: buildParsedTurns({
      turns: ordered.map((trace) => traceToConversationTurn({ trace })),
    }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
  });
  // The text alone: a cut made to honour the caller's own `max_tokens` is
  // what they asked for, and the renderer writes the omitted-turn marker into
  // the transcript, so there is no second signal for a consumer to read.
  return rendered.text;
}
