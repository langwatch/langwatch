import type { ChatMessage } from "../../model/transcript/types.ts";
import { parseContentBlocks } from "./content-parser.ts";
import { tryParseJSON } from "../../model/transcript/content-format.ts";
import { isRecord } from "../../model/transcript/record.ts";

const VALID_CHAT_ROLES = new Set(["system", "user", "assistant", "tool", "developer", "function"]);

function isOneChatMessage(item: unknown): item is ChatMessage {
  if (!isRecord(item)) return false;

  const obj = item;
  if (typeof obj.role !== "string") return false;
  if (!VALID_CHAT_ROLES.has(obj.role)) return false;
  const validContent =
    obj.content === null || typeof obj.content === "string" || Array.isArray(obj.content);
  const hasToolCalls = Array.isArray(obj.tool_calls);
  return validContent || hasToolCalls;
}

function isChatMessagesArray(data: unknown): data is ChatMessage[] {
  if (!Array.isArray(data)) return false;
  if (data.length === 0) return false;
  return data.every(isOneChatMessage);
}

function coerceDeclaredChatMessages(value: unknown[]): ChatMessage[] | null {
  const messages = value.filter(
    (item): item is ChatMessage =>
      typeof item === "object" && item !== null && ("role" in item || "content" in item),
  );
  return messages.length > 0 ? messages : null;
}

const COERCIBLE_KEYS = ["messages", "input", "history", "output", "data", "value", "events"];

/** Tries the declared-envelope shape, then each well-known field, in order. */
function coerceFromRecord(obj: Record<string, unknown>): ChatMessage[] | null {
  if (obj.type === "chat_messages" && Array.isArray(obj.value)) {
    const declared = coerceDeclaredChatMessages(obj.value);
    if (declared) return declared;
  }
  for (const key of COERCIBLE_KEYS) {
    const candidate = obj[key];
    if (candidate === undefined) continue;
    const result = coerceToChatMessages(candidate);
    if (result) return result;
  }
  return null;
}

export function coerceToChatMessages(data: unknown): ChatMessage[] | null {
  if (typeof data === "string") {
    const parsed = tryParseJSON(data);
    if (parsed !== null && parsed !== data) {
      return coerceToChatMessages(parsed);
    }
    return null;
  }
  if (isChatMessagesArray(data)) return data;
  if (isOneChatMessage(data)) return [data];
  if (isRecord(data)) return coerceFromRecord(data);
  return null;
}

/** Records a leaf for each renderable part of an array `content` field. */
function collectContentPartLeaves(
  content: Array<Record<string, unknown> | string>,
  msgIdx: number,
  leaves: Record<string, string>,
): void {
  content.forEach((part, partIdx) => {
    if (typeof part === "string") {
      if (part.length > 0) leaves[`${msgIdx}.${partIdx}`] = part;
      return;
    }
    if (!part || typeof part !== "object") return;
    if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
      leaves[`${msgIdx}.${partIdx}`] = part.text;
    }
  });
}

export function collectChatTextLeaves(messages: ChatMessage[]): Record<string, string> {
  const leaves: Record<string, string> = {};
  messages.forEach((message, msgIdx) => {
    const content = message.content;
    if (typeof content === "string") {
      const blocks = parseContentBlocks(content);
      if (blocks.length === 1 && blocks[0]!.kind === "text") {
        leaves[`${msgIdx}`] = content;
      }
      return;
    }
    if (!Array.isArray(content)) return;
    collectContentPartLeaves(content, msgIdx, leaves);
  });
  return leaves;
}

/** Applies edited leaf texts to one message's array `content`, if any changed. */
function applyTextLeavesToArrayContent(
  message: ChatMessage,
  content: Array<Record<string, unknown> | string>,
  msgIdx: number,
  texts: Record<string, string>,
): ChatMessage {
  let changed = false;
  const parts = content.map((part, partIdx) => {
    const text = texts[`${msgIdx}.${partIdx}`];
    if (text === undefined) return part;
    if (typeof part === "string") {
      if (text === part) return part;
      changed = true;
      return text;
    }
    const isTextPart = !!part && typeof part === "object" && part.type === "text";
    const carriesOtherText = isTextPart && typeof part.text === "string" && part.text !== text;
    if (carriesOtherText) {
      changed = true;
      return { ...part, text };
    }
    return part;
  });
  return changed ? { ...message, content: parts } : message;
}

export function applyChatTextLeaves(
  messages: ChatMessage[],
  texts: Record<string, string>,
): ChatMessage[] {
  return messages.map((message, msgIdx) => {
    if (typeof message.content === "string") {
      const whole = texts[`${msgIdx}`];
      return whole !== undefined && whole !== message.content
        ? { ...message, content: whole }
        : message;
    }
    if (!Array.isArray(message.content)) return message;
    return applyTextLeavesToArrayContent(message, message.content, msgIdx, texts);
  });
}
