import {
  coerceToChatMessages,
  tryParseJSON,
} from "~/shared/traces/transcript/parsing";
import { splitChatForPanel } from "~/shared/traces/transcript/splitChatForPanel";
import type { ChatMessage } from "~/shared/traces/transcript/types";
import type { Span, SpanInputOutput, Trace } from "../tracer/types";

/**
 * The chat messages of a trace, as the trace drawer's I/O panels show them.
 *
 * `parseLLMSpanMessages` in this directory reads the same idea off raw OTel
 * span attributes for the playground resume. This module starts from mapped
 * `Span` values, whose input and output are already typed
 * (`{type: "chat_messages", value: [...]}` and friends), so it normalises with
 * the transcript parser the panels use and agrees with what a reader saw.
 */

/**
 * The trace-level fallback content: whatever the fold picked as the trace's
 * primary input and output (`ComputedInput` / `ComputedOutput`).
 */
export type TraceIOSource = Pick<Trace, "input" | "output">;

export interface LlmTraceMessages {
  input: ChatMessage[];
  output: ChatMessage[];
}

/**
 * The LLM span whose messages stand for the trace: the last one whose input
 * reads as a chat conversation.
 *
 * Last rather than first because an agent loop's final model call carries the
 * whole history, and because it is the call that produced the answer. A span
 * whose input is a bare string or a non-chat object is skipped, so a trace
 * that only embeds a prompt template does not get read as a conversation.
 * Null when no LLM span carries chat input.
 */
export function chooseLlmSpanForTrace({
  spans,
}: {
  spans: Span[];
}): Span | null {
  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i]!;
    if (span.type !== "llm") continue;
    if (spanIOToChatMessages(span.input) !== null) return span;
  }
  return null;
}

/**
 * The chosen LLM span's conversation, split the way the drawer's two panels
 * split it. Falls back to the trace's own primary input and output when no LLM
 * span carries chat input, which is the common case for traces recorded by an
 * SDK that only reports trace-level text. Null when there is nothing to read.
 */
export function llmMessagesForTrace({
  trace,
  spans,
}: {
  trace: TraceIOSource;
  spans: Span[];
}): LlmTraceMessages | null {
  const span = chooseLlmSpanForTrace({ spans });
  if (span) {
    const input = spanIOToChatMessages(span.input) ?? [];
    const output =
      spanIOToChatMessages(span.output) ??
      wrapAsMessage({ text: spanIOToText(span.output), role: "assistant" });
    return {
      input: splitChatForPanel({ messages: input, panel: "input" }),
      output: splitChatForPanel({ messages: output, panel: "output" }),
    };
  }

  const inputText = trace.input?.value ?? "";
  const outputText = trace.output?.value ?? "";
  if (!inputText && !outputText) return null;
  const input =
    coerceToChatMessages(inputText) ??
    wrapAsMessage({ text: inputText, role: "user" });
  const output =
    coerceToChatMessages(outputText) ??
    wrapAsMessage({ text: outputText, role: "assistant" });
  return {
    input: splitChatForPanel({ messages: input, panel: "input" }),
    output: splitChatForPanel({ messages: output, panel: "output" }),
  };
}

/**
 * A typed span payload as chat messages, or null when it is not chat-shaped.
 * A `text` / `raw` payload is a JSON string often enough that it is worth
 * parsing before giving up, which is what the I/O panel does with the same
 * value.
 */
function spanIOToChatMessages(
  io: SpanInputOutput | null | undefined,
): ChatMessage[] | null {
  if (!io) return null;
  const value = (io as { value?: unknown }).value;
  if (value === undefined || value === null) return null;
  if (typeof value === "string")
    return coerceToChatMessages(tryParseJSON(value));
  return coerceToChatMessages(value);
}

/** A typed span payload as plain text, for the non-chat fallback. */
function spanIOToText(io: SpanInputOutput | null | undefined): string {
  if (!io) return "";
  const value = (io as { value?: unknown }).value;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * A payload that is not chat-shaped still has to come back as messages, so it
 * becomes one message on the side it was recorded. Empty text yields no
 * message rather than an empty one.
 */
function wrapAsMessage({
  text,
  role,
}: {
  text: string;
  role: "user" | "assistant";
}): ChatMessage[] {
  return text ? [{ role, content: text }] : [];
}
