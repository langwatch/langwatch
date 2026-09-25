import { isReplyTextPart } from "@langwatch/trace-contract";

import {
  isInjectedContextOnly,
  extractSystemReminderText,
} from "./coding-agent-transcript-context.ts";

const RECOVERED_REPLY_MATCH_CHARS = 200;

export function extractOutputText(output: string | null | undefined): string | null {
  if (typeof output !== "string" || output.trim().length === 0) return null;

  const raw = output.trim();
  if (!raw.startsWith("{") && !raw.startsWith("[")) return raw;

  try {
    return extractParsedOutputText(JSON.parse(raw));
  } catch {
    return raw;
  }
}

/** The reply a parsed output carries: a string, a message list, or a typed text/chat value. */
function extractParsedOutputText(parsed: unknown): string | null {
  if (typeof parsed === "string") return parsed.length > 0 ? parsed : null;
  if (Array.isArray(parsed)) return extractMessagesReplyText(parsed);
  if (!parsed || typeof parsed !== "object") return null;

  const inputOutput = parsed as { type?: unknown; value?: unknown };
  if (inputOutput.type === "text" && typeof inputOutput.value === "string") {
    return inputOutput.value.length > 0 ? inputOutput.value : null;
  }
  if (inputOutput.type === "chat_messages" && Array.isArray(inputOutput.value)) {
    return extractMessagesReplyText(inputOutput.value);
  }
  return null;
}

export function extractSystemText(input: string | null | undefined): string | null {
  const messages = parseChatMessages(input);
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
      firstUserReminders = extractSystemReminderText(candidate.content);
    }
  }

  if (firstUserReminders !== null) parts.push(firstUserReminders);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

export function parseChatMessages(input: string | null | undefined): unknown[] | null {
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

export function extractOutputMessagesText(raw: string | null): string | null {
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return extractMessagesReplyText(Array.isArray(parsed) ? parsed : [parsed]);
  } catch {
    return null;
  }
}

function extractMessagesReplyText(messages: unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as {
      role?: unknown;
      content?: unknown;
      parts?: unknown;
    } | null;
    if (!message) continue;
    if (!isAssistantRole(message.role)) continue;

    const contentText = extractContentText(message.content);
    if (contentText !== null) return contentText;

    const partsText = extractPartsText(message.parts);
    if (partsText !== null) return partsText;
  }

  return null;
}

function isAssistantRole(role: unknown): boolean {
  return role === void 0 || role === "assistant" || role === "model";
}

function extractContentText(content: unknown): string | null {
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

function extractPartsText(parts: unknown): string | null {
  if (!Array.isArray(parts)) return null;

  const texts = parts.flatMap((part) => {
    const candidate = part as { text?: unknown; thought?: unknown };
    return isReplyTextPart(candidate) ? [candidate.text] : [];
  });

  return texts.length > 0 ? texts.join("\n") : null;
}

export function extractGeminiResponseText(raw: string | null): string | null {
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
