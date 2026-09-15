/**
 * Gemini Content Format Conversion
 *
 * Helpers for translating the Gemini API content shapes carried in
 * Vertex AI Agent Engine (Google ADK) payloads — { role, parts:
 * [{ text | function_call | function_response }] } — into canonical
 * chat messages. Used by the VertexAdk extractor.
 */

import { isReplyTextPart } from "@langwatch/trace-contract";
import { isNonEmptyString, isRecord, safeStringify } from "./canonical-guard.rules.ts";

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
  if (role === "model") {
    return "assistant";
  }
  return isNonEmptyString(role) ? role : defaultRole;
};

/**
 * Converts a single Gemini content object ({ role, parts }) into chat
 * messages. Text and function_call parts fold into one message (an
 * assistant turn can carry both text and tool calls); function_response
 * parts become separate tool-role messages, matching chat semantics —
 * ADK wraps tool results in a user-role content.
 */
const toolCallFromFunctionCall = (fc: Record<string, unknown>): unknown => ({
  ...(isNonEmptyString(fc.id) ? { id: fc.id } : {}),
  type: "function",
  function: {
    name: isNonEmptyString(fc.name) ? fc.name : "",
    arguments: safeStringify(fc.args ?? {}) ?? "{}",
  },
});

const toolMessageFromFunctionResponse = (fr: Record<string, unknown>): unknown => ({
  role: "tool",
  ...(isNonEmptyString(fr.id) ? { tool_call_id: fr.id } : {}),
  ...(isNonEmptyString(fr.name) ? { name: fr.name } : {}),
  content: safeStringify(fr.response ?? {}) ?? "{}",
});

/** The text and tool calls of one turn, held until a function response or the end flushes them. */
type GeminiTurn = { texts: string[]; toolCalls: unknown[] };

/** Emits the buffered turn as one message — a turn can carry both text and tool calls. */
const flushGeminiTurn = (turn: GeminiTurn, role: string, messages: unknown[]): void => {
  if (turn.texts.length === 0 && turn.toolCalls.length === 0) return;

  messages.push({
    role,
    ...(turn.texts.length > 0 ? { content: turn.texts.join("\n") } : {}),
    ...(turn.toolCalls.length > 0 ? { tool_calls: turn.toolCalls } : {}),
  });
  turn.texts = [];
  turn.toolCalls = [];
};

const foldGeminiPart = (
  part: unknown,
  turn: GeminiTurn,
  role: string,
  messages: unknown[],
): void => {
  if (!isRecord(part)) return;

  if (typeof part.text === "string") {
    if (isReplyTextPart(part)) turn.texts.push(part.text);
    return;
  }

  if (isRecord(part.function_call)) {
    turn.toolCalls.push(toolCallFromFunctionCall(part.function_call));
    return;
  }

  if (isRecord(part.function_response)) {
    flushGeminiTurn(turn, role, messages);
    messages.push(toolMessageFromFunctionResponse(part.function_response));
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
  if (!isRecord(content)) {
    return [];
  }

  const role = geminiRoleToChatRole({ role: content.role, defaultRole });
  const parts = Array.isArray(content.parts) ? content.parts : [];

  const messages: unknown[] = [];
  const turn: GeminiTurn = { texts: [], toolCalls: [] };
  for (const part of parts) {
    foldGeminiPart(part, turn, role, messages);
  }
  flushGeminiTurn(turn, role, messages);

  return messages;
};

/**
 * ADK system instructions are usually a plain string, but the Gemini API
 * also accepts a content object ({ parts: [{ text }] }) or a list of
 * strings/parts.
 */
export const systemInstructionText = (raw: unknown): string | null => {
  if (typeof raw === "string") {
    return raw.length > 0 ? raw : null;
  }

  const partsToText = (parts: unknown[]): string | null => {
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

  if (Array.isArray(raw)) {
    return partsToText(raw);
  }
  const parts = isRecord(raw) ? raw.parts : undefined;
  if (Array.isArray(parts)) {
    return partsToText(parts);
  }
  return null;
};

/**
 * Tool-call args/response arrive as a JSON string or an already-parsed
 * object. Normalise to a non-empty string for langwatch.input/output.
 */
export const stringifyToolPayload = (raw: unknown): string | null => {
  if (raw === void 0 || raw === null) {
    return null;
  }
  if (typeof raw === "string") {
    return raw.length > 0 ? raw : null;
  }
  return safeStringify(raw);
};
