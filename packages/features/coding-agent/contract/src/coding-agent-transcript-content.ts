import { isReplyTextPart } from "@langwatch/trace-contract";
import { isInjectedContextOnly, systemReminderText } from "./coding-agent-transcript-context";

const RECOVERED_REPLY_MATCH_CHARS = 200;

export function extractedOutputText(output: string | null | undefined): string | null {
  if (typeof output !== "string" || output.trim().length === 0) return null;

  const raw = output.trim();
  if (!raw.startsWith("{") && !raw.startsWith("[")) return raw;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "string") return parsed.length > 0 ? parsed : null;
    if (Array.isArray(parsed)) return messagesReplyText(parsed);
    if (!parsed || typeof parsed !== "object") return null;

    const inputOutput = parsed as { type?: unknown; value?: unknown };
    if (inputOutput.type === "text" && typeof inputOutput.value === "string") {
      return inputOutput.value.length > 0 ? inputOutput.value : null;
    }
    if (inputOutput.type === "chat_messages" && Array.isArray(inputOutput.value)) {
      return messagesReplyText(inputOutput.value);
    }

    return null;
  } catch {
    return raw;
  }
}

export function extractedSystemText(input: string | null | undefined): string | null {
  const messages = parsedChatMessages(input);
  if (messages === null) return null;

  const parts: string[] = [];
  let firstUserReminders: string | null = null;

  for (const message of messages) {
    const candidate = message as { role?: unknown; content?: unknown } | null;
    if (typeof candidate?.content !== "string" || candidate.content.length === 0) continue;

    if (candidate.role === "system") {
      parts.push(candidate.content);
      continue;
    }
    if (candidate.role === "user" && isInjectedContextOnly(candidate.content)) {
      parts.push(candidate.content);
      continue;
    }
    if (candidate.role === "user" && firstUserReminders === null) {
      firstUserReminders = systemReminderText(candidate.content);
    }
  }

  if (firstUserReminders !== null) parts.push(firstUserReminders);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

export function parsedChatMessages(input: string | null | undefined): unknown[] | null {
  if (typeof input !== "string") return null;

  const raw = input.trim();
  if (!raw.startsWith("[") && !raw.startsWith("{")) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;

  const wrapper = parsed as { type?: unknown; value?: unknown };
  if (wrapper.type !== "chat_messages" || !Array.isArray(wrapper.value)) return null;
  return wrapper.value;
}

export function isSameRecoveredReply(candidate: string, previous: string | null): boolean {
  if (previous === null) return false;
  if (candidate === previous) return true;

  const width = Math.min(RECOVERED_REPLY_MATCH_CHARS, candidate.length, previous.length);
  if (width < RECOVERED_REPLY_MATCH_CHARS) return false;
  return candidate.slice(0, width) === previous.slice(0, width);
}

export function outputMessagesText(raw: string | null): string | null {
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return messagesReplyText(Array.isArray(parsed) ? parsed : [parsed]);
  } catch {
    return null;
  }
}

function messagesReplyText(messages: unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as {
      role?: unknown;
      content?: unknown;
      parts?: unknown;
    } | null;
    if (!message) continue;
    if (!isAssistantRole(message.role)) continue;

    const contentText = contentTextOf(message.content);
    if (contentText !== null) return contentText;

    const partsText = partsTextOf(message.parts);
    if (partsText !== null) return partsText;
  }

  return null;
}

function isAssistantRole(role: unknown): boolean {
  return role === void 0 || role === "assistant" || role === "model";
}

function contentTextOf(content: unknown): string | null {
  if (typeof content === "string") return content.length > 0 ? content : null;
  if (!Array.isArray(content)) return null;

  const texts = content.flatMap((part) => {
    const candidate = part as { text?: unknown; type?: unknown };
    const type = candidate.type;
    const isText = type === void 0 || type === "text" || type === "output_text";
    return isText && isReplyTextPart(candidate) ? [candidate.text] : [];
  });

  return texts.length > 0 ? texts.join("\n") : null;
}

function partsTextOf(parts: unknown): string | null {
  if (!Array.isArray(parts)) return null;

  const texts = parts.flatMap((part) => {
    const candidate = part as { text?: unknown; thought?: unknown };
    return isReplyTextPart(candidate) ? [candidate.text] : [];
  });

  return texts.length > 0 ? texts.join("\n") : null;
}

export function geminiResponseText(raw: string | null): string | null {
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    const roots = Array.isArray(parsed) ? parsed : [parsed];
    const texts = roots.flatMap(candidateTexts);
    return texts.length > 0 ? texts.join("\n") : null;
  } catch {
    return raw;
  }
}

function candidateTexts(root: unknown): string[] {
  const candidates = (root as { candidates?: unknown })?.candidates;
  if (!Array.isArray(candidates)) return [];

  return candidates.flatMap((candidate) => {
    const parts = (candidate as { content?: { parts?: unknown } })?.content?.parts;
    if (!Array.isArray(parts)) return [];

    return parts.flatMap((part) => {
      const value = part as { text?: unknown; thought?: unknown };
      return isReplyTextPart(value) ? [value.text] : [];
    });
  });
}
