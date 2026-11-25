import { isRecord, parseJSON } from "./content-format.ts";
import { parseContentBlocks } from "./content-parser.ts";
import { parseLangChainMessage } from "./langchain-messages.ts";
import type { ChatMessage } from "./types.ts";

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

/** A batch (`[[...messages]]`, as LangChain records chat model calls) flattened to one list. */
function flattenBatch(items: unknown[]): unknown[] {
  return items.length > 0 && items.every(Array.isArray) ? items.flat() : items;
}

function coerceOneMessage(item: unknown): ChatMessage | null {
  return isOneChatMessage(item) ? item : parseLangChainMessage(item);
}

/** Every item as a chat message, or null when any item is not one. */
function coerceMessageList(items: unknown[]): ChatMessage[] | null {
  const flat = flattenBatch(items);
  if (flat.length === 0) return null;
  const messages: ChatMessage[] = [];
  for (const item of flat) {
    const message = coerceOneMessage(item);
    if (!message) return null;
    messages.push(message);
  }
  return messages;
}

function isDeclaredChatMessage(item: unknown): item is ChatMessage {
  if (!isRecord(item)) return false;
  const content = item.content;
  const hasContent = content === null || typeof content === "string" || Array.isArray(content);
  return typeof item.role === "string" || hasContent;
}

function coerceDeclaredChatMessages(value: unknown[]): ChatMessage[] | null {
  const messages = flattenBatch(value).flatMap((item): ChatMessage[] => {
    const converted = parseLangChainMessage(item);
    if (converted) return [converted];
    return isDeclaredChatMessage(item) ? [item] : [];
  });
  return messages.length > 0 ? messages : null;
}

function findNestedChatMessages(obj: Record<string, unknown>): ChatMessage[] | null {
  const keys = ["messages", "input", "history", "output", "data", "value", "events", "generations"];
  for (const key of keys) {
    const candidate = obj[key];
    if (candidate === undefined) continue;

    const result = coerceToChatMessages(candidate);
    if (result) return result;
  }

  return null;
}

export function coerceToChatMessages(data: unknown): ChatMessage[] | null {
  if (typeof data === "string") {
    const parsed = parseJSON(data);
    if (parsed !== null && parsed !== data) {
      return coerceToChatMessages(parsed);
    }
    return null;
  }
  if (isChatMessagesArray(data)) return data;
  if (Array.isArray(data)) return coerceMessageList(data);
  if (isOneChatMessage(data)) return [data];
  const langChainMessage = parseLangChainMessage(data);
  if (langChainMessage) return [langChainMessage];
  if (!isRecord(data)) return null;
  const obj = data;
  if (obj.type === "chat_messages" && Array.isArray(obj.value)) {
    const declared = coerceDeclaredChatMessages(obj.value);
    if (declared) return declared;
  }

  return findNestedChatMessages(obj);
}

function collectPartTextLeaf(
  part: Record<string, unknown> | string,
  key: string,
  leaves: Record<string, string>,
): void {
  if (typeof part === "string") {
    if (part.length > 0) leaves[key] = part;
    return;
  }
  if (!part || typeof part !== "object") return;
  if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
    leaves[key] = part.text;
  }
}

function collectMessageTextLeaves(
  message: ChatMessage,
  msgIdx: number,
  leaves: Record<string, string>,
): void {
  const content = message.content;
  if (typeof content === "string") {
    const blocks = parseContentBlocks(content);
    if (blocks.length === 1 && blocks[0]?.kind === "text") {
      leaves[`${msgIdx}`] = content;
    }
    return;
  }
  if (!Array.isArray(content)) return;
  content.forEach((part, partIdx) => collectPartTextLeaf(part, `${msgIdx}.${partIdx}`, leaves));
}

export function collectChatTextLeaves(messages: ChatMessage[]): Record<string, string> {
  const leaves: Record<string, string> = {};
  messages.forEach((message, msgIdx) => collectMessageTextLeaves(message, msgIdx, leaves));
  return leaves;
}

function applyPartText(
  part: Record<string, unknown> | string,
  text: string | undefined,
): Record<string, unknown> | string {
  if (text === undefined) return part;
  if (typeof part === "string") return text === part ? part : text;
  const isTextPart = !!part && typeof part === "object" && part.type === "text";
  const carriesOtherText = isTextPart && typeof part.text === "string" && part.text !== text;
  return carriesOtherText ? { ...part, text } : part;
}

function applyMessageTextLeaves(
  message: ChatMessage,
  msgIdx: number,
  texts: Record<string, string>,
): ChatMessage {
  if (typeof message.content === "string") {
    const whole = texts[`${msgIdx}`];
    return whole !== undefined && whole !== message.content
      ? { ...message, content: whole }
      : message;
  }
  if (!Array.isArray(message.content)) return message;
  let changed = false;
  const parts = message.content.map((part, partIdx) => {
    const next = applyPartText(part, texts[`${msgIdx}.${partIdx}`]);
    changed ||= next !== part;
    return next;
  });
  return changed ? { ...message, content: parts } : message;
}

export function applyChatTextLeaves(
  messages: ChatMessage[],
  texts: Record<string, string>,
): ChatMessage[] {
  return messages.map((message, msgIdx) => applyMessageTextLeaves(message, msgIdx, texts));
}
