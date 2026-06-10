// Above this we render raw text without trying to JSON.parse — guards
// against multi-MB payloads locking the renderer.
const MAX_PARSE_BYTES = 2 * 1024 * 1024;
const MAX_CONTENT_DEPTH = 6;
const INLINE_VALUE_MAX_CHARS = 96;
const LEAF_LENGTH = 80;

export type AttributeFormat =
  | "leaf"
  | "chat"
  | "json"
  | "json-string"
  | "text";

export const KNOWN_CHAT_ROLES: ReadonlySet<string> = new Set([
  "user",
  "assistant",
  "system",
  "tool",
  "function",
  "developer",
]);

export interface ChatMessage {
  role: string;
  content: string;
}

export interface InlineDescriptor {
  text: string;
  hint?: string;
}

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
  if (value === null || value === undefined) return "leaf";

  if (typeof value === "object") {
    if (looksLikeChatArray(value)) return "chat";
    return "json";
  }

  if (typeof value !== "string") return "leaf";

  const trimmed = value.trim();
  if (trimmed.length === 0) return "leaf";

  if (
    trimmed.length <= LEAF_LENGTH &&
    !trimmed.includes("\n") &&
    !looksJsonShaped(trimmed)
  ) {
    return "leaf";
  }

  if (trimmed.length > MAX_PARSE_BYTES) return "text";

  if (looksJsonShaped(trimmed)) {
    const parsed = tryParseJson(trimmed);
    if (parsed !== undefined) {
      if (looksLikeChatArray(parsed)) return "chat";
      return "json-string";
    }
  }

  return "text";
}

function looksJsonShaped(s: string): boolean {
  return (
    (s.startsWith("{") && s.endsWith("}")) ||
    (s.startsWith("[") && s.endsWith("]"))
  );
}

export function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function looksLikeChatArray(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  // Majority-vote so a stray non-chat element doesn't demote a real chat
  // array to plain JSON.
  let hits = 0;
  for (const item of value) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as { role?: unknown }).role === "string" &&
      "content" in (item as object)
    ) {
      hits += 1;
    }
  }
  return hits >= Math.ceil(value.length / 2);
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
    hint:
      raw.length > INLINE_VALUE_MAX_CHARS
        ? humanizeBytes(raw.length)
        : undefined,
  };
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function humanizeBytes(n: number): string {
  if (n < 1024) return `${n}b`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}kb`;
  return `${(n / 1024 / 1024).toFixed(1)}mb`;
}

export function stringifyForCopy(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function normaliseChat(items: unknown[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const role = typeof obj.role === "string" ? obj.role : "unknown";
    const content = extractMessageContent(obj.content, 0);
    out.push({ role, content });
  }
  return out;
}

// `depth` bounds recursion against pathological nested content arrays.
function extractMessageContent(content: unknown, depth: number): string {
  if (depth >= MAX_CONTENT_DEPTH) return "";
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (trimmed.startsWith('{"type":"text"')) {
      const inner = tryParseJson(trimmed) as { text?: unknown } | undefined;
      if (inner && typeof inner.text === "string") return inner.text;
    }
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        parts.push(part);
        continue;
      }
      if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        if (p.type === "text" && typeof p.text === "string") {
          parts.push(p.text);
        } else if (Array.isArray(p.content)) {
          parts.push(extractMessageContent(p.content, depth + 1));
        }
      }
    }
    return parts.join("\n");
  }
  return "";
}
