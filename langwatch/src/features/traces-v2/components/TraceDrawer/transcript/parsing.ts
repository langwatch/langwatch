import type { ChatMessage, ContentBlock } from "./types";

/**
 * Heuristic: does this string look like an XML/tag-shaped payload (e.g. an
 * Anthropic-style prompt template with `<scenario>…</scenario>` blocks)?
 */
function looksLikeXml(s: string): boolean {
  const t = s.trim();
  if (t.length === 0 || t[0] !== "<") return false;
  return /<([a-zA-Z][\w-]*)(\s[^>]*)?>[\s\S]*?<\/\1\s*>/.test(t);
}

/**
 * Heuristic test for "this whole string is a JSON document". We only fence
 * when the entire content parses — a JSON snippet embedded in prose stays
 * as-is so the prose still renders normally.
 */
function looksLikeJson(s: string): boolean {
  const t = s.trim();
  if (t.length === 0) return false;
  if (t[0] !== "{" && t[0] !== "[") return false;
  const last = t[t.length - 1];
  if (last !== "}" && last !== "]") return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format raw text as markdown, wrapping it in a fenced code block when the
 * content is recognisably one of: XML, a JSON document. This is what gives
 * the conversation bubbles syntax-highlighted code snippets via the
 * existing `RenderedMarkdown` → Shiki pipeline.
 */
export function asMarkdownBody(content: string): string {
  if (looksLikeXml(content)) {
    return "```xml\n" + content + "\n```";
  }
  if (looksLikeJson(content)) {
    return "```json\n" + tryPrettyJson(content) + "\n```";
  }
  return content;
}

export function tryPrettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function tryParseJSON(s: string): unknown | null {
  try {
    const trimmed = s.trim();
    if (
      (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
      (trimmed.endsWith("}") || trimmed.endsWith("]"))
    ) {
      return JSON.parse(trimmed);
    }
    return null;
  } catch {
    return null;
  }
}

const VALID_CHAT_ROLES = new Set([
  "system",
  "user",
  "assistant",
  "tool",
  "developer",
  "function",
]);

function isOneChatMessage(item: unknown): item is ChatMessage {
  if (typeof item !== "object" || item === null) return false;
  const obj = item as Record<string, unknown>;
  if (typeof obj.role !== "string") return false;
  if (!VALID_CHAT_ROLES.has(obj.role)) return false;
  const validContent =
    obj.content === null ||
    typeof obj.content === "string" ||
    Array.isArray(obj.content);
  const hasToolCalls = Array.isArray(obj.tool_calls);
  return validContent || hasToolCalls;
}

function isChatMessagesArray(data: unknown): data is ChatMessage[] {
  if (!Array.isArray(data)) return false;
  if (data.length === 0) return false;
  return data.every(isOneChatMessage);
}

/**
 * Try to coerce a parsed value into a chat message array. Handles every
 * shape we've seen in trace input/output payloads:
 *   - the array itself                  `[{role,content},...]`
 *   - a single message object           `{role,content}`
 *   - an envelope w/ `messages` field   `{messages: [...]}`
 *   - same with `input`/`history`/`output`/`data`/`value` keys
 *   - any of the above as a stringified JSON value (double-stringified)
 *   - any of the above with the inner `content` field itself a JSON string
 *     of a typed block (`'{"type":"thinking",…}'`) — those get parsed lazy
 *     by `parseContentBlocks` later, so we just keep the message.
 *
 * Returns null if the data genuinely isn't chat-shaped.
 */
export function coerceToChatMessages(data: unknown): ChatMessage[] | null {
  // Unwrap one level of stringification — some traces store the chat as a
  // JSON-encoded string field.
  if (typeof data === "string") {
    const parsed = tryParseJSON(data);
    if (parsed !== null && parsed !== data) {
      return coerceToChatMessages(parsed);
    }
    return null;
  }
  if (isChatMessagesArray(data)) return data;
  if (isOneChatMessage(data)) return [data];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    for (const key of [
      "messages",
      "input",
      "history",
      "output",
      "data",
      "value",
      "events",
    ]) {
      const candidate = obj[key];
      if (candidate === undefined) continue;
      const result = coerceToChatMessages(candidate);
      if (result) return result;
    }
  }
  return null;
}

/**
 * Find the position of the matching closing `}` for the JSON object that
 * starts at `start`. String-literal aware so escaped quotes don't fool it.
 */
function findJsonObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function extractInlineBlocks(content: string): ContentBlock[] {
  if (!content) return [];
  const out: ContentBlock[] = [];
  let cursor = 0;
  let textBuffer = "";

  const flushText = () => {
    if (textBuffer.length === 0) return;
    const t = textBuffer.replace(/^\s+|\s+$/g, "");
    if (t.length > 0) out.push({ kind: "text", text: textBuffer });
    textBuffer = "";
  };

  while (cursor < content.length) {
    const nextBrace = content.indexOf("{", cursor);
    if (nextBrace === -1) {
      textBuffer += content.slice(cursor);
      break;
    }

    const end = findJsonObjectEnd(content, nextBrace);
    if (end === -1) {
      textBuffer += content.slice(cursor);
      break;
    }

    const slice = content.slice(nextBrace, end + 1);
    if (!slice.includes('"type":')) {
      textBuffer += content.slice(cursor, end + 1);
      cursor = end + 1;
      continue;
    }

    let consumed = false;
    try {
      const parsed = JSON.parse(slice) as Record<string, unknown>;
      if (parsed && typeof parsed.type === "string") {
        const blocks = parseContentBlocks([parsed]);
        const block = blocks[0];
        if (block && block.kind !== "raw") {
          textBuffer += content.slice(cursor, nextBrace);
          flushText();
          out.push(block);
          consumed = true;
        }
      }
    } catch {
      // not a clean JSON object — fall through and keep as text
    }

    if (!consumed) {
      textBuffer += content.slice(cursor, end + 1);
    }
    cursor = end + 1;
  }

  flushText();
  return out;
}

export function parseContentBlocks(
  content: ChatMessage["content"],
): ContentBlock[] {
  if (content == null) return [];
  if (typeof content === "string") {
    if (content.length === 0) return [];
    const trimmed = content.trim();

    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const blocks = parseContentBlocks(parsed);
          if (
            blocks.length > 0 &&
            blocks.some((b) => b.kind !== "text" && b.kind !== "raw")
          ) {
            return blocks;
          }
        } else if (parsed && typeof parsed === "object") {
          const single = parseContentBlocks([
            parsed as Record<string, unknown>,
          ]);
          if (single.length > 0 && single[0]!.kind !== "raw") {
            return single;
          }
        }
      } catch {
        // fall through to inline-blocks scanner
      }
    }

    if (content.includes('"type":"')) {
      const inline = extractInlineBlocks(content);
      if (inline.some((b) => b.kind !== "text" && b.kind !== "raw")) {
        return inline;
      }
    }

    return [{ kind: "text", text: content }];
  }
  if (!Array.isArray(content)) {
    if (content && typeof content === "object") {
      return parseContentBlocks([content as Record<string, unknown>]);
    }
    return [];
  }

  const out: ContentBlock[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      if (part.length > 0) out.push({ kind: "text", text: part });
      continue;
    }
    if (!part || typeof part !== "object") continue;
    const obj = part as Record<string, unknown>;
    const type = typeof obj.type === "string" ? obj.type : "";
    switch (type) {
      case "text": {
        const text = typeof obj.text === "string" ? obj.text : "";
        if (!text) break;
        // The `text` field may itself be a JSON-encoded typed block —
        // Claude Code traces do this: `{type:"text", text:"{\"type\":
        // \"thinking\",\"thinking\":\"…\"}"}`. Unwrap one level so the
        // proper kind reaches the renderer instead of being shown as
        // a text dump of JSON.
        const trimmed = text.trim();
        if (
          trimmed.length > 0 &&
          trimmed[0] === "{" &&
          trimmed[trimmed.length - 1] === "}" &&
          trimmed.includes('"type":"')
        ) {
          try {
            const inner = JSON.parse(trimmed) as Record<string, unknown>;
            if (
              inner &&
              typeof inner === "object" &&
              typeof inner.type === "string" &&
              inner.type !== "text"
            ) {
              const innerBlocks = parseContentBlocks([inner]);
              const first = innerBlocks[0];
              if (first && first.kind !== "raw") {
                out.push(...innerBlocks);
                break;
              }
            }
          } catch {
            // not clean JSON — fall through to a plain text block
          }
        }
        out.push({ kind: "text", text });
        break;
      }
      case "thinking":
      case "reasoning": {
        const text =
          (typeof obj.thinking === "string" && obj.thinking) ||
          (typeof obj.text === "string" && obj.text) ||
          "";
        if (text) out.push({ kind: "thinking", text });
        break;
      }
      case "tool_use": {
        out.push({
          kind: "tool_use",
          id: typeof obj.id === "string" ? obj.id : undefined,
          name: typeof obj.name === "string" ? obj.name : "tool",
          input: obj.input,
        });
        break;
      }
      case "tool_result": {
        out.push({
          kind: "tool_result",
          toolUseId:
            typeof obj.tool_use_id === "string" ? obj.tool_use_id : undefined,
          content: obj.content,
          isError: obj.is_error === true,
        });
        break;
      }
      default:
        out.push({ kind: "raw", data: obj });
    }
  }
  return out;
}

function joinTextBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter(
      (b): b is Extract<ContentBlock, { kind: "text" }> => b.kind === "text",
    )
    .map((b) => b.text)
    .join("\n");
}

/**
 * Pull the readable prose for a given role out of a trace `input`/`output`
 * payload. Handles every common shape:
 *   - plain string                          → returns it
 *   - single message object                 → text from its content
 *   - chat message array                    → text from the most recent
 *                                             matching role
 *   - typed-block content array on its own  → joined text blocks
 *
 * Useful for compact bubble previews where we don't want to render the
 * full block stack but still need clean text instead of raw JSON.
 */
export function extractReadableText(
  raw: string | null | undefined,
  prefer: "user" | "assistant",
): string {
  if (!raw) return "";

  // Try to parse as JSON first; the bulk of the messy shapes are JSON.
  const parsed = tryParseJSON(raw);

  // Chat array — walk backwards for the most recent matching role.
  const chat = coerceToChatMessages(parsed);
  if (chat) {
    for (let i = chat.length - 1; i >= 0; i--) {
      const msg = chat[i]!;
      if (msg.role === prefer) {
        const text = joinTextBlocks(parseContentBlocks(msg.content));
        if (text.trim()) return text;
      }
    }
    // Fallback: any text from any message.
    for (let i = chat.length - 1; i >= 0; i--) {
      const text = joinTextBlocks(parseContentBlocks(chat[i]!.content));
      if (text.trim()) return text;
    }
    return "";
  }

  // Bare typed-block array (no role wrapper).
  if (Array.isArray(parsed)) {
    const blocks = parseContentBlocks(
      parsed as Array<Record<string, unknown> | string>,
    );
    const text = joinTextBlocks(blocks);
    if (text.trim()) return text;
  }

  // Bare typed-block object (no role wrapper).
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const blocks = parseContentBlocks([parsed as Record<string, unknown>]);
    const text = joinTextBlocks(blocks);
    if (text.trim()) return text;
  }

  // Not chat-shaped — return the raw string.
  return raw;
}

export function getReasoning(
  message: ChatMessage,
  blocks: ContentBlock[],
): string {
  if (
    typeof message.reasoning_content === "string" &&
    message.reasoning_content
  ) {
    return message.reasoning_content;
  }
  if (typeof message.thinking === "string" && message.thinking) {
    return message.thinking;
  }
  const fromBlocks = blocks
    .filter(
      (b): b is Extract<ContentBlock, { kind: "thinking" }> =>
        b.kind === "thinking",
    )
    .map((b) => b.text)
    .join("\n\n");
  return fromBlocks;
}

/**
 * Extract reasoning from a trace input/output payload.
 */
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

export function toolResultBodyToString(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (
          c &&
          typeof c === "object" &&
          "text" in c &&
          typeof (c as { text?: unknown }).text === "string"
        ) {
          return (c as { text: string }).text;
        }
        try {
          return JSON.stringify(c);
        } catch {
          return String(c);
        }
      })
      .join("\n");
  }
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}
