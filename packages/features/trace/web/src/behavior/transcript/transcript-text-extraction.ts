import type { ChatMessage, ContentBlock } from "../../model/transcript/types";
import { coerceToChatMessages } from "./chat-message-coercion";
import { parseContentBlocks } from "./content-parser";
import { tryParseJSON } from "../../model/transcript/content-format";
import { isRecord } from "../../model/transcript/record";

function joinTextBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { kind: "text" }> => b.kind === "text")
    .map((b) => b.text)
    .join("\n");
}

export function extractReadableText(
  raw: string | null | undefined,
  prefer: "user" | "assistant",
): string {
  if (!raw) return "";

  const parsed = tryParseJSON(raw);
  const chat = coerceToChatMessages(parsed);
  if (chat) {
    for (let i = chat.length - 1; i >= 0; i--) {
      const msg = chat[i]!;
      if (msg.role === prefer) {
        const text = joinTextBlocks(parseContentBlocks(msg.content));
        if (text.trim()) return text;
      }
    }
    for (let i = chat.length - 1; i >= 0; i--) {
      const text = joinTextBlocks(parseContentBlocks(chat[i]!.content));
      if (text.trim()) return text;
    }
    return "";
  }

  if (Array.isArray(parsed)) {
    const content = parsed.filter(
      (item): item is Record<string, unknown> | string =>
        typeof item === "string" || isRecord(item),
    );
    const blocks = parseContentBlocks(content);
    const text = joinTextBlocks(blocks);
    if (text.trim()) return text;
  }

  if (isRecord(parsed)) {
    const blocks = parseContentBlocks([parsed]);
    const text = joinTextBlocks(blocks);
    if (text.trim()) return text;
  }

  return raw;
}

export function extractSystemText(raw: string | null | undefined): string {
  if (!raw) return "";
  const chat = coerceToChatMessages(tryParseJSON(raw));
  if (!chat) return "";
  for (const msg of chat) {
    if (msg.role !== "system") continue;
    const text = joinTextBlocks(parseContentBlocks(msg.content));
    if (text.trim()) return text;
  }
  return "";
}

export function getReasoning(message: ChatMessage, blocks: ContentBlock[]): string {
  if (typeof message.reasoning_content === "string" && message.reasoning_content) {
    return message.reasoning_content;
  }
  if (typeof message.thinking === "string" && message.thinking) {
    return message.thinking;
  }
  return blocks
    .filter((b): b is Extract<ContentBlock, { kind: "thinking" }> => b.kind === "thinking")
    .map((b) => b.text)
    .join("\n\n");
}

export function extractReasoningText(raw: string | null | undefined): string {
  if (!raw) return "";
  const parsed = tryParseJSON(raw);
  const chat = coerceToChatMessages(parsed);
  if (chat) {
    for (let i = chat.length - 1; i >= 0; i--) {
      const msg = chat[i]!;
      if (msg.role === "assistant") {
        const reasoning = getReasoning(msg, parseContentBlocks(msg.content));
        if (reasoning.trim()) return reasoning;
      }
    }
  }
  return "";
}
