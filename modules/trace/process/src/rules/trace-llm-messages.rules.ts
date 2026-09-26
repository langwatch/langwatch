import {
  extractSystemInstructions,
  type Span,
  type SpanInputOutput,
  type Trace,
} from "@langwatch/trace-contract";
import {
  type ChatMessage,
  coerceToChatMessages,
  parseJSON,
  splitChatForPanel,
} from "@langwatch/trace-contract/transcript";

/**
 * The chat messages of a trace, as the trace drawer's I/O panels show them.
 * `parseLLMSpanMessages` reads the same idea off raw OTel attributes; this
 * starts from mapped `Span` values, already typed.
 */

/** The trace-level fallback content the fold picked as primary input/output. */
export type TraceIOSource = Pick<Trace, "input" | "output">;

export interface LlmTraceMessages {
  input: ChatMessage[];
  output: ChatMessage[];
}

/**
 * The LLM span whose messages stand for the trace: the last one whose input
 * reads as a chat conversation, because an agent loop's final model call
 * carries the whole history and is the call that produced the answer.
 */
export function pickLlmSpanForTrace({ spans }: { spans: Span[] }): Span | null {
  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i]!;
    if (span.type !== "llm") continue;
    if (coerceSpanIOToChatMessages(span.input) !== null) return span;
  }
  return null;
}

/**
 * One span's conversation, split the way the drawer's two panels split it.
 * Never null: a span with no readable payload answers with two empty lists,
 * because the caller asked about *this* span.
 */
export function extractLlmMessagesForSpan({ span }: { span: Span }): LlmTraceMessages {
  const input = withSystemInstructions({
    messages: coerceSpanIOToChatMessages(span.input) ?? [],
    params: span.params,
  });
  const output =
    coerceSpanIOToChatMessages(span.output) ??
    wrapAsMessage({ text: spanIOToText(span.output), role: "assistant" });
  return {
    input: splitChatForPanel({ messages: input, panel: "input" }),
    output: splitChatForPanel({ messages: output, panel: "output" }),
  };
}

/**
 * The chosen LLM span's conversation, falling back to the trace's own primary
 * input and output when no LLM span carries chat input — the common case for
 * an SDK that only reports trace-level text. Null when there is nothing to read.
 */
export function extractLlmMessagesForTrace({
  trace,
  spans,
}: {
  trace: TraceIOSource;
  spans: Span[];
}): LlmTraceMessages | null {
  const span = pickLlmSpanForTrace({ spans });
  if (span) return extractLlmMessagesForSpan({ span });

  const inputText = trace.input?.value ?? "";
  const outputText = trace.output?.value ?? "";
  if (!inputText && !outputText) return null;
  const input = coerceToChatMessages(inputText) ?? wrapAsMessage({ text: inputText, role: "user" });
  const output =
    coerceToChatMessages(outputText) ?? wrapAsMessage({ text: outputText, role: "assistant" });
  return {
    input: splitChatForPanel({ messages: input, panel: "input" }),
    output: splitChatForPanel({ messages: output, panel: "output" }),
  };
}

/**
 * A typed span payload as chat messages, or null when it is not chat-shaped.
 * A `text`/`raw` payload is a JSON string often enough to be worth parsing
 * first, which is what the I/O panel does with the same value.
 */
function coerceSpanIOToChatMessages(io: SpanInputOutput | null | undefined): ChatMessage[] | null {
  if (!io) return null;
  const raw: unknown = io.value;
  if (raw === undefined || raw === null) return null;
  const value = typeof raw === "string" ? parseJSON(raw) : raw;
  return coerceToChatMessages(fromGenAiPartsMessages(value));
}

/**
 * OTel GenAI messages carry `parts` instead of `content`
 * (`{ role, parts: [{ type: "text", content }] }`); read them as chat
 * messages with their text, tool calls and tool results.
 */
function fromGenAiPartsMessages(value: unknown): unknown {
  if (!Array.isArray(value) || value.length === 0) return value;
  if (!value.every(isGenAiPartsMessage)) return value;
  return value.flatMap(genAiPartsToMessages);
}

interface GenAiPartsMessage {
  role: string;
  parts: Record<string, unknown>[];
}

function isGenAiPartsMessage(item: unknown): item is GenAiPartsMessage {
  if (!item || typeof item !== "object") return false;
  const { role, parts, content } = item as Record<string, unknown>;
  return typeof role === "string" && Array.isArray(parts) && content === undefined;
}

function genAiPartsToMessages({ role, parts }: GenAiPartsMessage): ChatMessage[] {
  const text = parts
    .filter((part) => part.type === "text" && typeof part.content === "string")
    .map((part) => part.content as string)
    .join("\n");
  const toolCalls = parts
    .filter((part) => part.type === "tool_call")
    .map((part) => ({
      id: typeof part.id === "string" ? part.id : "",
      type: "function",
      function: {
        name: typeof part.name === "string" ? part.name : "",
        arguments: jsonText(part.arguments),
      },
    }));
  const results: ChatMessage[] = parts
    .filter((part) => part.type === "tool_call_response")
    .map((part) => ({
      role: "tool",
      content: jsonText(part.response ?? part.result),
      ...(typeof part.id === "string" ? { tool_call_id: part.id } : {}),
    }));
  const hasOwnMessage = text.length > 0 || toolCalls.length > 0 || results.length === 0;
  const own: ChatMessage[] = hasOwnMessage
    ? [{ role, content: text, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) }]
    : [];
  return [...own, ...results];
}

function jsonText(value: unknown): string {
  if (typeof value === "string") return value;
  return value === undefined ? "" : JSON.stringify(value);
}

/**
 * Canonicalisation moves a system prompt out of the input messages into
 * `gen_ai.system_instructions`; a reader of the messages still needs it.
 */
function withSystemInstructions({
  messages,
  params,
}: {
  messages: ChatMessage[];
  params: Span["params"];
}): ChatMessage[] {
  const system = extractSystemInstructions(params ?? null);
  if (!system || messages.some((message) => message.role === "system")) return messages;
  return [{ role: "system", content: system }, ...messages];
}

/** A typed span payload as plain text, for the non-chat fallback. */
function spanIOToText(io: SpanInputOutput | null | undefined): string {
  if (!io) return "";
  const value: unknown = io.value;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * A payload that is not chat-shaped still comes back as messages, so it
 * becomes one message on the side it was recorded. Empty text yields none.
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
