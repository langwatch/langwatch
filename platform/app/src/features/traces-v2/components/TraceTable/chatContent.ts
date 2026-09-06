type ChatRole = "system" | "user" | "assistant" | "tool";

interface ChatMessage {
  role?: ChatRole | string;
  content?: unknown;
  tool_calls?: Array<{ function?: { name?: string } }>;
}

export interface ParsedIO {
  text: string;
  isChat: boolean;
  isTool: boolean;
}

const SNIPPET_LENGTH = 80;
const ELLIPSIS = "\u2026";

function snippet(text: string): string {
  return text.length > SNIPPET_LENGTH
    ? text.slice(0, SNIPPET_LENGTH) + ELLIPSIS
    : text;
}

function isMessageArray(value: unknown): value is ChatMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === "object" &&
    value[0] !== null &&
    "role" in value[0]
  );
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function contentToString(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (
          part &&
          typeof part === "object" &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return JSON.stringify(content);
}

export function contentToText(raw: string | null | undefined): string {
  if (!raw) return "";
  const parsed = tryParseJson(raw);
  if (parsed === undefined) return raw;
  if (isMessageArray(parsed)) {
    const last = parsed[parsed.length - 1]!;
    if (last.tool_calls?.[0]?.function?.name) {
      return `${last.tool_calls[0].function.name}(...)`;
    }
    return contentToString(last.content);
  }
  if (typeof parsed === "object" && parsed !== null) {
    return JSON.stringify(parsed);
  }
  return raw;
}

export function tryParseChat(raw: string | null | undefined): ParsedIO {
  if (!raw) return { text: "", isChat: false, isTool: false };
  const parsed = tryParseJson(raw);
  if (isMessageArray(parsed)) {
    const last = parsed[parsed.length - 1]!;
    const toolName = last.tool_calls?.[0]?.function?.name;
    if (toolName) {
      return { text: `${toolName}(...)`, isChat: false, isTool: true };
    }
    return {
      text: snippet(contentToString(last.content)),
      isChat: true,
      isTool: false,
    };
  }
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return {
      text: snippet(JSON.stringify(parsed)),
      isChat: false,
      isTool: false,
    };
  }
  return { text: snippet(raw), isChat: false, isTool: false };
}

export function findMessageContent({
  raw,
  role,
  pick,
}: {
  raw: string | null | undefined;
  role: ChatRole;
  pick: "first" | "last";
}): string {
  if (!raw) return "";
  const parsed = tryParseJson(raw);
  if (!isMessageArray(parsed)) {
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return JSON.stringify(parsed);
    }
    return raw;
  }
  const candidates = parsed.filter((m) => m.role === role);
  const match = pick === "first" ? candidates[0] : candidates.at(-1);
  return match ? contentToString(match.content) : "";
}

export function parseSystemPrompt(raw: string | null | undefined): string {
  return findMessageContent({ raw, role: "system", pick: "first" });
}

export function truncateText({
  text,
  limit,
}: {
  text: string;
  limit: number;
}): string {
  if (limit <= 0 || text.length <= limit) return text;
  return text.slice(0, limit) + ELLIPSIS;
}
