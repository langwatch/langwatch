/**
 * Gemini Content Format Conversion
 *
 * Helpers for translating the Gemini API content shapes carried in
 * Vertex AI Agent Engine (Google ADK) payloads — { role, parts:
 * [{ text | function_call | function_response }] } — into canonical
 * chat messages. Used by the VertexAdk extractor.
 */

import { isNonEmptyString, isRecord } from "./_guards";
import { isReplyTextPart } from "./_parts";

export const safeStringify = (value: unknown): string | null => {
  try {
    const s = JSON.stringify(value);
    return typeof s === "string" ? s : null;
  } catch {
    return null;
  }
};

/**
 * Gemini content roles are "user" | "model"; chat messages use
 * "user" | "assistant".
 */
const geminiRoleToChatRole = ({
  role,
  defaultRole,
}: {
  role: unknown;
  defaultRole: string;
}): string => {
  if (role === "model") return "assistant";
  return isNonEmptyString(role) ? role : defaultRole;
};

type GeminiContentAccumulator = {
  role: string;
  messages: unknown[];
  texts: string[];
  toolCalls: unknown[];
};

const flushGeminiAccumulator = (acc: GeminiContentAccumulator): void => {
  if (acc.texts.length === 0 && acc.toolCalls.length === 0) return;
  acc.messages.push({
    role: acc.role,
    ...(acc.texts.length > 0 ? { content: acc.texts.join("\n") } : {}),
    ...(acc.toolCalls.length > 0 ? { tool_calls: acc.toolCalls } : {}),
  });
  acc.texts = [];
  acc.toolCalls = [];
};

const toolCallFromFunctionCall = (fc: Record<string, unknown>): unknown => ({
  ...(isNonEmptyString(fc.id) ? { id: fc.id } : {}),
  type: "function",
  function: {
    name: isNonEmptyString(fc.name) ? fc.name : "",
    arguments: safeStringify(fc.args ?? {}) ?? "{}",
  },
});

const toolResultMessageFromFunctionResponse = (
  fr: Record<string, unknown>,
): unknown => ({
  role: "tool",
  ...(isNonEmptyString(fr.id) ? { tool_call_id: fr.id } : {}),
  ...(isNonEmptyString(fr.name) ? { name: fr.name } : {}),
  content: safeStringify(fr.response ?? {}) ?? "{}",
});

const applyGeminiPart = (
  acc: GeminiContentAccumulator,
  part: unknown,
): void => {
  if (!isRecord(part)) return;

  if (typeof part.text === "string") {
    if (isReplyTextPart(part)) acc.texts.push(part.text);
    return;
  }

  if (isRecord(part.function_call)) {
    acc.toolCalls.push(toolCallFromFunctionCall(part.function_call));
    return;
  }

  if (isRecord(part.function_response)) {
    flushGeminiAccumulator(acc);
    acc.messages.push(
      toolResultMessageFromFunctionResponse(part.function_response),
    );
  }
};

/**
 * Converts a single Gemini content object ({ role, parts }) into chat
 * messages. Text and function_call parts fold into one message (an
 * assistant turn can carry both text and tool calls); function_response
 * parts become separate tool-role messages, matching chat semantics —
 * ADK wraps tool results in a user-role content.
 */
export const convertGeminiContent = ({
  content,
  defaultRole,
}: {
  content: unknown;
  defaultRole: string;
}): unknown[] => {
  if (!isRecord(content)) return [];

  const role = geminiRoleToChatRole({ role: content.role, defaultRole });
  const parts = Array.isArray(content.parts) ? content.parts : [];

  const acc: GeminiContentAccumulator = {
    role,
    messages: [],
    texts: [],
    toolCalls: [],
  };
  for (const part of parts) {
    applyGeminiPart(acc, part);
  }
  flushGeminiAccumulator(acc);

  return acc.messages;
};

/**
 * ADK system instructions are usually a plain string, but the Gemini API
 * also accepts a content object ({ parts: [{ text }] }) or a list of
 * strings/parts.
 */
const geminiPartsToText = (parts: unknown[]): string | null => {
  const texts: string[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      texts.push(part);
    } else if (isRecord(part) && typeof part.text === "string") {
      texts.push(part.text);
    }
  }
  return texts.length > 0 ? texts.join("\n") : null;
};

export const systemInstructionText = (raw: unknown): string | null => {
  if (typeof raw === "string") {
    return raw.length > 0 ? raw : null;
  }

  if (Array.isArray(raw)) return geminiPartsToText(raw);
  if (isRecord(raw) && Array.isArray(raw.parts))
    return geminiPartsToText(raw.parts);
  return null;
};

/**
 * Tool-call args/response arrive as a JSON string or an already-parsed
 * object. Normalise to a non-empty string for langwatch.input/output.
 */
export const stringifyToolPayload = (raw: unknown): string | null => {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string") return raw.length > 0 ? raw : null;
  return safeStringify(raw);
};
