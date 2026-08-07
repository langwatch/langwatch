import type { PromptStudioSpanResult } from "./types";

type ChatMessage = PromptStudioSpanResult["messages"][number];

/**
 * Parses the input (request prompt) + output (assistant reply) messages
 * carried on an LLM-kind span's attributes into a flat ordered list, the
 * shape the trace→playground "Open in Prompts" loader feeds into the chat.
 *
 * Reads, in fallback order:
 *
 *   - input:  `gen_ai.input.messages` → `gen_ai.prompt` → `langwatch.input`
 *   - output: `gen_ai.completion` → `gen_ai.output.messages` → `langwatch.output`
 *
 * Each attribute is a JSON-encoded string emitted by the producing SDK.
 * Three wire shapes are accepted because different SDKs serialize the
 * same logical thing differently:
 *
 *   1. TypedValueJson wrapper: `{"type":"chat_messages","value":[...]}` —
 *      the LangWatch python-sdk's canonical shape for explicit
 *      input/output rendering on a span.
 *   2. Bare array of `{role, content}` message objects — what nlpgo's
 *      `langwatch.input` on an LLM span carries (`[]app.ChatMessage`
 *      JSON-encoded).
 *   3. Bare SINGLE message object `{role, content}` — what nlpgo's
 *      `langwatch.output` on an LLM span carries (a single
 *      `app.ChatMessage` JSON-encoded, NOT an array). This shape was
 *      not handled pre-fix and the assistant reply was silently
 *      dropped from the playground "Open in Prompts" resume.
 *
 * Falls back to wrapping the raw string as a single user/assistant turn
 * when JSON parsing fails or the shape is unrecognized, so the resume
 * never crashes on a stranger trace.
 *
 * Default role is `user` for input, `assistant` for output. Embedded
 * roles always win when the shape carries them.
 */
export function parseLLMSpanMessages(
  attrs: Record<string, unknown>,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  const inputStr =
    (attrs["gen_ai.input.messages"] as string) ??
    (attrs["gen_ai.prompt"] as string) ??
    (attrs["langwatch.input"] as string);
  if (inputStr) {
    pushDecoded(messages, inputStr, "user");
  }

  const outputStr =
    (attrs["gen_ai.completion"] as string) ??
    (attrs["gen_ai.output.messages"] as string) ??
    (attrs["langwatch.output"] as string);
  if (outputStr) {
    pushDecoded(messages, outputStr, "assistant");
  }

  return messages;
}

/** True for the LangWatch python-sdk's TypedValueJson chat-messages wrapper. */
function isTypedChatMessagesEnvelope(
  parsed: unknown,
): parsed is { type: "chat_messages"; value: unknown[] } {
  return (
    !!parsed &&
    typeof parsed === "object" &&
    (parsed as { type?: unknown }).type === "chat_messages" &&
    Array.isArray((parsed as { value?: unknown }).value)
  );
}

function pushMessageItem(
  out: ChatMessage[],
  item: unknown,
  defaultRole: "user" | "assistant",
): void {
  if (
    item &&
    typeof item === "object" &&
    typeof (item as { content?: unknown }).content === "string"
  ) {
    const role = (item as { role?: unknown }).role;
    out.push({
      role: (typeof role === "string"
        ? role
        : defaultRole) as ChatMessage["role"],
      content: (item as { content: string }).content,
    });
  }
}

function pushMessageItems(
  out: ChatMessage[],
  items: unknown[],
  defaultRole: "user" | "assistant",
): void {
  for (const item of items) {
    pushMessageItem(out, item, defaultRole);
  }
}

/**
 * Fallback for payloads that matched none of the message shapes: a wrapped
 * `{value: string}` envelope, or the parsed value already being a string.
 */
function pushWrappedOrPlainString(
  out: ChatMessage[],
  parsed: unknown,
  defaultRole: "user" | "assistant",
): void {
  const wrapped =
    parsed && typeof parsed === "object"
      ? (parsed as { value?: unknown }).value
      : undefined;
  if (typeof wrapped === "string") {
    out.push({ role: defaultRole, content: wrapped });
  } else if (typeof parsed === "string") {
    out.push({ role: defaultRole, content: parsed });
  }
}

/**
 * Decodes one already-JSON-parsed payload into `out`, matching the three
 * accepted wire shapes (typed chat-messages envelope, bare array, bare
 * single message object) or falling back to a wrapped/plain string.
 */
function decodeParsedPayload(
  out: ChatMessage[],
  parsed: unknown,
  defaultRole: "user" | "assistant",
): void {
  if (isTypedChatMessagesEnvelope(parsed)) {
    // Normalize role for every entry the same way the bare-array and
    // single-object branches do — an item with a missing or non-string
    // role gets `defaultRole`. Pre-fix this branch trusted the typed-
    // wrapper assertion and let invalid roles through, producing an
    // inconsistent shape vs the sibling branches.
    pushMessageItems(out, parsed.value, defaultRole);
  } else if (Array.isArray(parsed)) {
    pushMessageItems(out, parsed, defaultRole);
  } else if (
    parsed &&
    typeof parsed === "object" &&
    typeof (parsed as { content?: unknown }).content === "string"
  ) {
    pushMessageItem(out, parsed, defaultRole);
  } else {
    pushWrappedOrPlainString(out, parsed, defaultRole);
  }
}

function pushDecoded(
  out: ChatMessage[],
  raw: string,
  defaultRole: "user" | "assistant",
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    out.push({ role: defaultRole, content: raw });
    return;
  }

  // Track baseline so we can detect the "all branches matched a
  // structure but produced zero entries" case — e.g. `{type:"chat_
  // messages", value:[]}` or `{type:"chat_messages", value:[{bad}]}`
  // where every item failed the filter. Without this guard the
  // attribute would be silently dropped from the playground resume
  // even though we had a payload to surface. Falling back to a single
  // raw-content turn keeps something visible in the chat instead of
  // pretending the LLM said nothing.
  const before = out.length;

  decodeParsedPayload(out, parsed, defaultRole);

  // Last-resort fallback: a payload was present but every recognized
  // shape produced zero entries (empty array, malformed items,
  // unrecognized envelope). Surface the raw string so the trace is
  // never silently empty — visible-but-ugly beats invisible-and-lost.
  if (out.length === before) {
    out.push({ role: defaultRole, content: raw });
  }
}
