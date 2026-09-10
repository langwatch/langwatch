import type { PromptStudioSpanResult } from "@langwatch/trace-contract";

type ChatMessage = PromptStudioSpanResult["messages"][number];

/** One decoded turn, or nothing when the value carried no string content. */
function tryTurnOf(value: unknown, defaultRole: "user" | "assistant"): ChatMessage | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const { content, role } = value as { content?: unknown; role?: unknown };
  if (typeof content !== "string") {
    return null;
  }

  return { role: (typeof role === "string" ? role : defaultRole) as ChatMessage["role"], content };
}

/**
 * The turns a decoded payload holds, in the three shapes emitters send: a typed chat-messages
 * envelope, a bare array, or a single message object. Roles are normalized the same way in each,
 * so an item with a missing or non-string role always takes the default.
 */
function turnsOf(parsed: unknown, defaultRole: "user" | "assistant"): ChatMessage[] {
  const envelope = parsed as { type?: unknown; value?: unknown } | null;
  const items =
    envelope && typeof parsed === "object" && envelope.type === "chat_messages"
      ? envelope.value
      : parsed;
  if (Array.isArray(items)) {
    return items.map((item) => tryTurnOf(item, defaultRole)).filter((turn) => turn !== null);
  }

  const single = tryTurnOf(parsed, defaultRole);
  if (single) {
    return [single];
  }

  const wrapped = envelope && typeof parsed === "object" ? envelope.value : void 0;
  if (typeof wrapped === "string") {
    return [{ role: defaultRole, content: wrapped }];
  }

  return typeof parsed === "string" ? [{ role: defaultRole, content: parsed }] : [];
}

/**
 * Decodes one attribute's turns onto `out`. A payload that parses but yields no turns falls back
 * to a single raw-content turn: visible and ugly beats invisible and lost, and without it the
 * attribute would be silently dropped from the playground resume.
 */
function pushDecoded(out: ChatMessage[], raw: string, defaultRole: "user" | "assistant"): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    out.push({ role: defaultRole, content: raw });

    return;
  }

  const turns = turnsOf(parsed, defaultRole);
  out.push(...(turns.length > 0 ? turns : [{ role: defaultRole, content: raw }]));
}

export class TraceLlmSpanMessagesService {
  static create(): TraceLlmSpanMessagesService {
    return new TraceLlmSpanMessagesService();
  }

  /**
   * Parses an LLM span's input and output message attributes into one flat ordered list, reading
   * `gen_ai.input.messages`, `gen_ai.prompt`, `langwatch.input` and `gen_ai.completion`,
   * `gen_ai.output.messages`, `langwatch.output` in that order. Unrecognized shapes become a turn.
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
