import {
  isMessageLike,
  isRecord,
  isUnknownArray,
  type MessageLike,
  safeStringify,
} from "./canonical-guard.rules";
import { isReplyTextPart } from "@langwatch/trace-contract";

/**
 * Extracts text content from a single message object.
 * Handles multiple message formats: OpenAI, Anthropic/Strands, Mastra parts, and generic.
 */
export const extractMessageContentText = (message: unknown): string | null => {
  if (!isRecord(message)) {
    return typeof message === "string" ? message : null;
  }

  const msg = message;

  if (typeof msg.content === "string") {
    return msg.content;
  }

  if (isUnknownArray(msg.content)) {
    const texts = extractTextsFromParts(msg.content);
    if (texts.length > 0) {
      return texts.join("\n");
    }
  }

  // Object with numeric keys (reconstructed from flattened OTEL attributes like
  // gen_ai.prompt.0.content.0.text → {"0": {"text": "..."}} instead of [{"text": "..."}])
  if (isObjectWithNumericKeys(msg.content)) {
    const texts = extractTextsFromParts(numericKeysToArray(msg.content));
    if (texts.length > 0) {
      return texts.join("\n");
    }
  }

  if (isUnknownArray(msg.parts)) {
    const texts = extractTextsFromParts(msg.parts);
    if (texts.length > 0) {
      return texts.join("\n");
    }
  }

  if (typeof msg.text === "string") {
    return msg.text;
  }

  if (typeof msg.value === "string") {
    return msg.value;
  }

  return null;
};

const extractTextsFromParts = (parts: unknown[]): string[] => {
  return parts.flatMap(extractTextsFromPart);
};

const extractTextsFromPart = (part: unknown): string[] => {
  if (typeof part === "string") {
    return [part];
  }
  if (!isRecord(part)) {
    return [];
  }

  if (typeof part.text === "string") {
    return isReplyTextPart(part) ? [part.text] : [];
  }
  if (typeof part.content === "string") {
    return [part.content];
  }
  if (part.type === "thinking" && typeof part.thinking === "string") {
    return [part.thinking];
  }
  if (part.type === "tool_use" && part.input != null) {
    const input = safeStringify(part.input);
    return input === null ? [] : [input];
  }
  if (part.type === "tool_result" && isUnknownArray(part.content)) {
    return joinExtractedTexts(extractTextsFromParts(part.content));
  }
  if (isRecord(part.toolUse) && part.toolUse.input != null) {
    const input = safeStringify(part.toolUse.input);
    return input === null ? [] : [input];
  }
  if (isRecord(part.toolResult) && isUnknownArray(part.toolResult.content)) {
    return joinExtractedTexts(extractBedrockToolResult(part.toolResult.content));
  }

  return [];
};

const joinExtractedTexts = (texts: string[]): string[] => {
  return texts.length === 0 ? [] : [texts.join("\n")];
};

const extractBedrockToolResult = (blocks: unknown[]): string[] => {
  return blocks.flatMap((block) => {
    // Key presence matters: `{ json: null }` is a valid union member.
    if (isRecord(block) && "json" in block) {
      const json = safeStringify(block.json);
      return json === null ? [] : [json];
    }

    return extractTextsFromPart(block);
  });
};

/**
 * Extracts the text content of the last user message from an array of messages.
 * Iterates backwards to find the most recent user message.
 */
export const extractLastUserMessageText = (messages: unknown): string | null => {
  if (!Array.isArray(messages)) {
    return null;
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!isRecord(msg) || msg.role !== "user") {
      continue;
    }
    const text = extractMessageContentText(msg);
    if (text) {
      return text;
    }
  }
  return null;
};

/**
 * Extracts text from a content block, handling both standard ({type:"text", text:"..."})
 * and pi-ai/Vercel AI SDK style ({type:"text", content:"..."}).
 */
const textFromBlock = (p: unknown): string | null => {
  if (!isRecord(p)) {
    return null;
  }
  if (typeof p.text === "string") {
    return p.text;
  }
  if (typeof p.content === "string") {
    return p.content;
  }
  return null;
};

/**
 * Gets the content array from a message, checking both `content` and `parts`
 * (Vercel AI SDK / pi-ai use `parts` instead of `content`).
 */
const getMessageContentOrParts = (msg: MessageLike): unknown => msg.content ?? msg.parts;

export const extractSystemInstructionFromMessages = (messages: unknown): string | null => {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  const first = messages[0];
  if (!isMessageLike(first) || !isSystemRole(first.role)) {
    return null;
  }

  const content = getMessageContentOrParts(first);
  if (content == null) {
    return null;
  }

  if (typeof content === "string") {
    return content;
  }

  if (isUnknownArray(content)) {
    const texts = content.map(textFromBlock).filter((p): p is string => p !== null);

    const extracted = texts.join("");
    return extracted.length > 0 ? extracted : null;
  }

  return null;
};

/**
 * True for the roles that carry SYSTEM instructions: the standard "system"
 * and the OpenAI Responses-dialect "developer" spelling. One predicate shared
 * by extraction and stripping so the two can never disagree on what counts.
 */
export const isSystemRole = (role: unknown): boolean => role === "system" || role === "developer";

/**
 * Filters out system-role messages (including the `developer` spelling) from
 * a messages array. System instructions are extracted separately via
 * extractSystemInstructionFromMessages.
 */
export const stripSystemMessages = (messages: unknown[]): unknown[] =>
  messages.filter((m) => !(isRecord(m) && isSystemRole(m.role)));

/**
 * Best-effort "messages" decoding from unknown payloads:
 * - array => assume messages
 * - { messages: [...] } => messages
 * - string => raw prompt/completion
 */
export const decodeMessagesPayload = (payload: unknown): unknown => {
  if (isUnknownArray(payload)) {
    return payload;
  }
  if (isRecord(payload) && isUnknownArray(payload.messages)) {
    return payload.messages;
  }
  return payload;
};

/**
 * Unwraps messages that are wrapped in an extra `{ message: {...} }` object.
 * Some telemetry formats wrap each message in an additional "message" property.
 */
export const unwrapWrappedMessages = (messages: unknown[]): unknown[] => {
  return messages.map((msg) => {
    if (isRecord(msg) && isRecord(msg.message) && Object.keys(msg).length === 1) {
      return msg.message;
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
  if (isUnknownArray(raw)) {
    return unwrapWrappedMessages(raw);
  }
  if (isRecord(raw) && isUnknownArray(raw.messages)) {
    return unwrapWrappedMessages(raw.messages);
  }
  return [{ role: defaultRole, content: raw }];
};

/**
 * Checks if a value is a non-array object whose keys are all non-negative
 * integer strings (e.g. {"0": ..., "1": ...}).  This pattern arises when
 * `safeUnflatten` reconstructs flattened OTEL attribute paths like
 * `gen_ai.prompt.0.content.0.text` — the inner numeric segments become
 * object keys instead of array indices.
 */
const isObjectWithNumericKeys = (v: unknown): v is Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return false;
  }
  const keys = Object.keys(v);
  return keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
};

/**
 * Converts an object with consecutive numeric keys into an array,
 * preserving index order.
 */
const numericKeysToArray = (obj: Record<string, unknown>): unknown[] => {
  const entries = Object.entries(obj).sort(([a], [b]) => Number(a) - Number(b));
  return entries.map(([, v]) => v);
};
