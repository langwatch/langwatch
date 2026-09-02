import { z } from "zod";

const MAX_PARSE_BYTES = 2 * 1024 * 1024;
const MAX_CONTENT_DEPTH = 6;
const INLINE_VALUE_MAX_CHARS = 96;
const LEAF_LENGTH = 80;

export type AttributeFormat = "leaf" | "chat" | "json" | "json-string" | "text";

export const KNOWN_CHAT_ROLES: ReadonlySet<string> = new Set([
  "user",
  "assistant",
  "system",
  "tool",
  "function",
  "developer",
]);

interface AttributeChatMessage {
  role: string;
  content: string;
}

export interface InlineDescriptor {
  text: string;
  hint?: string;
}

const chatEntrySchema = z.object({ role: z.string(), content: z.unknown() }).passthrough();
const chatMessageSchema = z
  .object({ role: z.string().optional(), content: z.unknown().optional() })
  .passthrough();
const textPartSchema = z.object({ type: z.literal("text"), text: z.string() }).passthrough();
const contentPartSchema = z
  .object({
    type: z.string().optional(),
    text: z.string().optional(),
    content: z.unknown().optional(),
  })
  .passthrough();

// Wraps detectFormat so a heuristic throw degrades to "text" instead
// of crashing the row.
export function safeDetectFormat(value: unknown): AttributeFormat {
  try {
    return detectFormat(value);
  } catch {
    return "text";
  }
}

export function detectFormat(value: unknown): AttributeFormat {
  if (value === null || value === void 0) {
    return "leaf";
  }

  if (typeof value === "object") {
    if (looksLikeChatArray(value)) {
      return "chat";
    }
    return "json";
  }

  if (typeof value !== "string") {
    return "leaf";
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "leaf";
  }

  if (trimmed.length <= LEAF_LENGTH && !trimmed.includes("\n") && !looksJsonShaped(trimmed)) {
    return "leaf";
  }

  if (trimmed.length > MAX_PARSE_BYTES) {
    return "text";
  }

  if (looksJsonShaped(trimmed)) {
    const parsed = tryParseJson(trimmed);
    if (parsed !== void 0) {
      if (looksLikeChatArray(parsed)) {
        return "chat";
      }
      return "json-string";
    }
  }

  return "text";
}

function looksJsonShaped(s: string): boolean {
  return (s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"));
}

export function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return void 0;
  }
}

function looksLikeChatArray(value: unknown): boolean {
  const parsed = z.array(z.unknown()).safeParse(value);
  if (!parsed.success || parsed.data.length === 0) {
    return false;
  }

  let hits = 0;
  for (const item of parsed.data) {
    if (chatEntrySchema.safeParse(item).success) {
      hits += 1;
    }
  }
  return hits >= Math.ceil(parsed.data.length / 2);
}

export function buildInlineDescriptor(
  value: unknown,
  format: AttributeFormat,
  raw: string,
): InlineDescriptor {
  if (format === "leaf") {
    return { text: typeof value === "string" ? value : raw };
  }

  if (format === "chat") {
    const parsed = typeof value === "string" ? tryParseJson(value) : value;
    const count = Array.isArray(parsed) ? parsed.length : 0;
    return {
      text: `chat · ${count} message${count === 1 ? "" : "s"}`,
      hint: humanizeBytes(raw.length),
    };
  }

  if (format === "json" || format === "json-string") {
    return {
      text: collapseWhitespace(raw).slice(0, INLINE_VALUE_MAX_CHARS),
      hint: humanizeBytes(raw.length),
    };
  }

  return {
    text: collapseWhitespace(raw).slice(0, INLINE_VALUE_MAX_CHARS),
    hint: raw.length > INLINE_VALUE_MAX_CHARS ? humanizeBytes(raw.length) : void 0,
  };
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function humanizeBytes(n: number): string {
  if (n < 1024) {
    return `${n}b`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)}kb`;
  }
  return `${(n / 1024 / 1024).toFixed(1)}mb`;
}

export function stringifyForCopy(value: unknown): string {
  if (value === null || value === void 0) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function normaliseChat(items: unknown[]): AttributeChatMessage[] {
  const out: AttributeChatMessage[] = [];
  for (const item of items) {
    const parsed = chatMessageSchema.safeParse(item);
    if (!parsed.success) {
      continue;
    }
    const role = parsed.data.role ?? "unknown";
    const content = extractMessageContent(parsed.data.content, 0);
    out.push({ role, content });
  }
  return out;
}

// `depth` bounds recursion against pathological nested content arrays.
function extractMessageContent(content: unknown, depth: number): string {
  if (depth >= MAX_CONTENT_DEPTH) {
    return "";
  }
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (trimmed.startsWith('{"type":"text"')) {
      const inner = textPartSchema.safeParse(tryParseJson(trimmed));
      if (inner.success) {
        return inner.data.text;
      }
    }
    return content;
  }
  const parsedParts = z.array(z.unknown()).safeParse(content);
  if (parsedParts.success) {
    const parts: string[] = [];
    for (const part of parsedParts.data) {
      if (typeof part === "string") {
        parts.push(part);
        continue;
      }
      const parsedPart = contentPartSchema.safeParse(part);
      if (!parsedPart.success) {
        continue;
      }
      const textPart = textPartSchema.safeParse(part);
      if (textPart.success) {
        parts.push(textPart.data.text);
        continue;
      }
      const nestedParts = z.array(z.unknown()).safeParse(parsedPart.data.content);
      if (nestedParts.success) {
        parts.push(extractMessageContent(nestedParts.data, depth + 1));
      }
    }
    return parts.join("\n");
  }
  return "";
}
