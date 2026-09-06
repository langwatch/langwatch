/**
 * Message Normalization & System Instruction Extraction
 */

import {
  isMessageLike,
  isRecord,
  isUnknownArray,
  type MessageLike,
  safeStringify,
} from "./_guards";
import { isReplyTextPart } from "./_parts";

// ─────────────────────────────────────────────────────────────────────────
// Shared message content extraction
// ─────────────────────────────────────────────────────────────────────────

/**
 * Extracts text content from a single message object.
 * Handles multiple message formats: OpenAI, Anthropic/Strands, Mastra parts, and generic.
 */
export const extractMessageContentText = (message: unknown): string | null => {
  if (!message || typeof message !== "object") {
    return typeof message === "string" ? message : null;
  }

  const msg = message as Record<string, unknown>;

  // String content (OpenAI format, most common)
  if (typeof msg.content === "string") return msg.content;

  // Content array (OpenAI multimodal / Strands / Anthropic)
  if (isUnknownArray(msg.content)) {
    const texts = extractTextsFromParts(msg.content);
    if (texts.length > 0) return texts.join("\n");
  }

  // Object with numeric keys (reconstructed from flattened OTEL attributes like
  // gen_ai.prompt.0.content.0.text → {"0": {"text": "..."}} instead of [{"text": "..."}])
  if (isObjectWithNumericKeys(msg.content)) {
    const texts = extractTextsFromParts(numericKeysToArray(msg.content));
    if (texts.length > 0) return texts.join("\n");
  }

  // Parts array (Mastra / Vercel AI SDK)
  if (isUnknownArray(msg.parts)) {
    const texts = extractTextsFromParts(msg.parts);
    if (texts.length > 0) return texts.join("\n");
  }

  // Text field (some formats)
  if (typeof msg.text === "string") return msg.text;

  // Value field (LangWatch structured format)
  if (typeof msg.value === "string") return msg.value;

  return null;
};

/**
 * Extracts text strings from content/parts arrays.
 * Handles plain strings, {type:"text", text:...}, {text:...}, {content:...},
 * {type:"thinking", thinking:...}, {type:"tool_use", input:...}, and
 * {type:"tool_result", content:...} so unwrapped Anthropic typed blocks
 * still surface as a meaningful raw match. Also handles the AWS Bedrock
 * Converse block union, which is discriminated by which key is present
 * rather than a `type` field: {toolUse:{...}} and {toolResult:{content:[...]}}.
 */
const extractTextsFromParts = (parts: unknown[]): string[] => {
  const texts: string[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      texts.push(part);
      continue;
    }
    if (isRecord(part)) {
      if (typeof part.text === "string") {
        if (!isReplyTextPart(part)) continue;
        texts.push(part.text);
      } else if (typeof part.content === "string") {
        texts.push(part.content);
      } else if (
        part.type === "thinking" &&
        typeof part.thinking === "string"
      ) {
        texts.push(part.thinking);
      } else if (part.type === "tool_use" && part.input != null) {
        const s = safeStringify(part.input);
        if (s !== null) texts.push(s);
      } else if (part.type === "tool_result" && isUnknownArray(part.content)) {
        const inner = extractTextsFromParts(part.content);
        if (inner.length > 0) texts.push(inner.join("\n"));
      } else if (isRecord(part.toolUse) && part.toolUse.input != null) {
        // `input` is a required field on the Converse ToolUseBlock struct, not
        // a union tag, so a value check is correct here — unlike the
        // toolResult content union below, where key presence discriminates.
        const s = safeStringify(part.toolUse.input);
        if (s !== null) texts.push(s);
      } else if (
        isRecord(part.toolResult) &&
        isUnknownArray(part.toolResult.content)
      ) {
        // Converse tool-result content is a union; we handle the {text} and
        // {json} variants and ignore the rest (document, image, video,
        // searchResult). The json variant is stringified in place so block
        // order survives.
        const inner: string[] = [];
        for (const block of part.toolResult.content) {
          // Key presence, not value: the union is discriminated by which key
          // exists, and {json: null} is a real block whose payload is JSON
          // null. A value check (`block.json != null`) drops it.
          if (isRecord(block) && "json" in block) {
            const s = safeStringify(block.json);
            if (s !== null) inner.push(s);
          } else {
            inner.push(...extractTextsFromParts([block]));
          }
        }
        if (inner.length > 0) texts.push(inner.join("\n"));
      }
    }
  }
  return texts;
};

/**
 * Extracts the text content of the last user message from an array of messages.
 * Iterates backwards to find the most recent user message.
 */
export const extractLastUserMessageText = (
  messages: unknown,
): string | null => {
  if (!Array.isArray(messages)) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") continue;
    const obj = msg as Record<string, unknown>;
    if (obj.role !== "user") continue;
    const text = extractMessageContentText(obj);
    if (text) return text;
  }
  return null;
};

/**
 * Extracts text from a content block, handling both standard ({type:"text", text:"..."})
 * and pi-ai/Vercel AI SDK style ({type:"text", content:"..."}).
 */
const textFromBlock = (p: unknown): string | null => {
  if (!isRecord(p)) return null;
  if (typeof p.text === "string") return p.text;
  if (typeof p.content === "string") return p.content;
  return null;
};

/**
 * Gets the content array from a message, checking both `content` and `parts`
 * (Vercel AI SDK / pi-ai use `parts` instead of `content`).
 */
const getMessageContentOrParts = (msg: MessageLike): unknown =>
  msg.content ?? msg.parts;

export const extractSystemInstructionFromMessages = (
  messages: unknown,
): string | null => {
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
    const texts = content
      .map(textFromBlock)
      .filter((p): p is string => p !== null);

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
export const isSystemRole = (role: unknown): boolean =>
  role === "system" || role === "developer";

/**
 * Filters out system-role messages (including the `developer` spelling) from
 * a messages array. System instructions are extracted separately via
 * extractSystemInstructionFromMessages.
 */
export const stripSystemMessages = (messages: unknown[]): unknown[] =>
  messages.filter(
    (m) =>
      !(
        m &&
        typeof m === "object" &&
        isSystemRole((m as Record<string, unknown>).role)
      ),
  );

/**
 * Best-effort "messages" decoding from unknown payloads:
 * - array => assume messages
 * - { messages: [...] } => messages
 * - string => raw prompt/completion
 */
export const decodeMessagesPayload = (payload: unknown): unknown => {
  if (isUnknownArray(payload)) return payload;
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
    if (
      isRecord(msg) &&
      isRecord(msg.message) &&
      Object.keys(msg).length === 1
    ) {
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

// ─────────────────────────────────────────────────────────────────────────
// Numeric-key object helpers (for reconstructed OTEL attributes)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Checks if a value is a non-array object whose keys are all non-negative
 * integer strings (e.g. {"0": ..., "1": ...}).  This pattern arises when
 * `safeUnflatten` reconstructs flattened OTEL attribute paths like
 * `gen_ai.prompt.0.content.0.text` — the inner numeric segments become
 * object keys instead of array indices.
 */
const isObjectWithNumericKeys = (v: unknown): v is Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
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
