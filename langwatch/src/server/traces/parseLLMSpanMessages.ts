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

  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as { type?: unknown }).type === "chat_messages" &&
    Array.isArray((parsed as { value?: unknown }).value)
  ) {
    out.push(
      ...((parsed as { value: ChatMessage[] }).value.filter(
        (m): m is ChatMessage =>
          !!m && typeof m === "object" && typeof m.content === "string",
      )),
    );
    return;
  }

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as { content?: unknown }).content === "string"
      ) {
        const role = (item as { role?: unknown }).role;
        out.push({
          role: typeof role === "string" ? role : defaultRole,
          content: (item as { content: string }).content,
        });
      }
    }
    return;
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    typeof (parsed as { content?: unknown }).content === "string"
  ) {
    const role = (parsed as { role?: unknown }).role;
    out.push({
      role: typeof role === "string" ? role : defaultRole,
      content: (parsed as { content: string }).content,
    });
    return;
  }

  const wrapped =
    parsed && typeof parsed === "object"
      ? (parsed as { value?: unknown }).value
      : undefined;
  if (typeof wrapped === "string") {
    out.push({ role: defaultRole, content: wrapped });
    return;
  }
  if (typeof parsed === "string") {
    out.push({ role: defaultRole, content: parsed });
    return;
  }
}
