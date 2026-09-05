import type { PromptStudioSpanResult } from "@langwatch/trace-contract";

type ChatMessage = PromptStudioSpanResult["messages"][number];

function pushDecoded(out: ChatMessage[], raw: string, defaultRole: "user" | "assistant"): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    out.push({ role: defaultRole, content: raw });

    return;
  }

  // Track baseline so we can detect the "all branches matched a structure but"
  // "produced zero entries" case (e.g. `{type:"chat_messages", value:[]}` or every
  // item failing the filter). Without this guard the attribute would be silently
  // dropped from the playground resume; falling back to a single raw-content turn
  // keeps something visible instead of pretending the LLM said nothing.
  const before = out.length;

  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as { type?: unknown }).type === "chat_messages" &&
    Array.isArray((parsed as { value?: unknown }).value)
  ) {
    // Normalize role for every entry the same way the bare-array and
    // single-object branches do — an item with a missing or non-string
    // role gets `defaultRole`. Pre-fix this branch trusted the typed-
    // wrapper assertion and let invalid roles through, producing an
    // inconsistent shape vs the sibling branches.
    for (const item of (parsed as { value: unknown[] }).value) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as { content?: unknown }).content === "string"
      ) {
        const role = (item as { role?: unknown }).role;
        out.push({
          role: (typeof role === "string" ? role : defaultRole) as ChatMessage["role"],
          content: (item as { content: string }).content,
        });
      }
    }
  } else if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as { content?: unknown }).content === "string"
      ) {
        const role = (item as { role?: unknown }).role;
        out.push({
          role: (typeof role === "string" ? role : defaultRole) as ChatMessage["role"],
          content: (item as { content: string }).content,
        });
      }
    }
  } else if (
    parsed &&
    typeof parsed === "object" &&
    typeof (parsed as { content?: unknown }).content === "string"
  ) {
    const role = (parsed as { role?: unknown }).role;
    out.push({
      role: (typeof role === "string" ? role : defaultRole) as ChatMessage["role"],
      content: (parsed as { content: string }).content,
    });
  } else {
    const wrapped =
      parsed && typeof parsed === "object" ? (parsed as { value?: unknown }).value : undefined;
    if (typeof wrapped === "string") {
      out.push({ role: defaultRole, content: wrapped });
    } else if (typeof parsed === "string") {
      out.push({ role: defaultRole, content: parsed });
    }
  }

  // Last-resort fallback: a payload was present but every recognized
  // shape produced zero entries (empty array, malformed items,
  // unrecognized envelope). Surface the raw string so the trace is
  // never silently empty — visible-but-ugly beats invisible-and-lost.
  if (out.length === before) {
    out.push({ role: defaultRole, content: raw });
  }
}

export class TraceLlmSpanMessagesService {
  static create(): TraceLlmSpanMessagesService {
    return new TraceLlmSpanMessagesService();
  }

  /**
   * Parses input (request prompt) + output (assistant reply) messages carried on an LLM-kind span's attributes into a flat ordered list, the shape the trace→playground "Open in Prompts" loader feeds into the chat. Reads, in fallback order, input `gen_ai.input.messages` → `gen_ai.prompt` → `langwatch.input` and output `gen_ai.completion` → `gen_ai.output.messages` → `langwatch.output`; each is a JSON-encoded string in one of three SDK-dependent wire shapes (TypedValueJson wrapper, bare message array, or bare single message object — the last was previously unhandled and silently dropped the assistant reply). Falls back to wrapping the raw string as a single turn when parsing fails or the shape is unrecognized. Default role is `user` for input, `assistant` for output; embedded roles win when present.
   */
  static parseLLMSpanMessages(attrs: Record<string, unknown>): ChatMessage[] {
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
}
