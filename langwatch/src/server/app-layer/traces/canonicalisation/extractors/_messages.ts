/**
 * Message Normalization & System Instruction Extraction
 */
import { isMessageLike, isRecord, type MessageLike } from "./_guards";

/**
 * Extracts text from a content block, handling both standard ({type:"text", text:"..."})
 * and pi-ai/Vercel AI SDK style ({type:"text", content:"..."}).
 */
const textFromBlock = (p: unknown): string | null => {
  if (!isRecord(p)) return null;
  const rec = p as Record<string, unknown>;
  if (typeof rec.text === "string") return rec.text;
  if (typeof rec.content === "string") return rec.content;
  return null;
};

/**
 * Gets the content array from a message, checking both `content` and `parts`
 * (Vercel AI SDK / pi-ai use `parts` instead of `content`).
 */
const getMessageContentOrParts = (msg: MessageLike): unknown =>
  msg.content ?? (msg as Record<string, unknown>).parts;

export const extractSystemInstructionFromMessages = (
  messages: unknown,
): string | null => {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  const first = messages[0];
  if (!isMessageLike(first) || first.role !== "system") {
    return null;
  }

  const content = getMessageContentOrParts(first);
  if (content == null) {
    return null;
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const texts = content
      .map(textFromBlock)
      .filter((p): p is string => p !== null);

    const extracted = texts.join("");
    return extracted.length > 0 ? extracted : null;
  }

  return null;
};

/**
 * Best-effort "messages" decoding from unknown payloads:
 * - array => assume messages
 * - { messages: [...] } => messages
 * - string => raw prompt/completion
 */
export const decodeMessagesPayload = (payload: unknown): unknown => {
  if (Array.isArray(payload)) return payload;
  if (
    isRecord(payload) &&
    Array.isArray((payload as Record<string, unknown>).messages)
  ) {
    return (payload as Record<string, unknown>).messages;
  }
  return payload;
};

/**
 * Unwraps messages that are wrapped in an extra `{ message: {...} }` object.
 * Some telemetry formats wrap each message in an additional "message" property.
 */
export const unwrapWrappedMessages = (messages: unknown[]): unknown[] => {
  return messages.map((msg) => {
    if (
      isRecord(msg) &&
      isRecord((msg as Record<string, unknown>).message) &&
      Object.keys(msg).length === 1
    ) {
      return (msg as Record<string, unknown>).message;
    }
    return msg;
  });
};

/**
 * Normalizes various input formats to a messages array.
 */
export const normalizeToMessages = (
  raw: unknown,
  defaultRole: "user" | "assistant" = "user",
): unknown[] | null => {
  if (typeof raw === "string") {
    return [{ role: defaultRole, content: raw }];
  }
  if (Array.isArray(raw)) {
    return unwrapWrappedMessages(raw);
  }
  if (
    isRecord(raw) &&
    Array.isArray((raw as Record<string, unknown>).messages)
  ) {
    return unwrapWrappedMessages(
      (raw as Record<string, unknown>).messages as unknown[],
    );
  }
  return [{ role: defaultRole, content: raw }];
};
