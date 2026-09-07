import type { ChatMessage, ContentBlock } from "../../model/transcript/types.ts";
import { mediaPartToMediaData } from "./media-part.ts";
import { isRecord } from "../../model/transcript/record.ts";

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

/** Parses one inline-scanned JSON slice into a block, or null when it's not a real block. */
function tryConsumeInlineJsonBlock(slice: string): ContentBlock | null {
  try {
    const parsed: unknown = JSON.parse(slice);
    if (isRecord(parsed) && typeof parsed.type === "string") {
      const blocks = parseContentBlocks([parsed]);
      const block = blocks[0];
      if (block && block.kind !== "raw") return block;
    }
  } catch {
    // Keep malformed inline objects as text.
  }
  return null;
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

    const block = tryConsumeInlineJsonBlock(slice);
    if (block) {
      textBuffer += content.slice(cursor, nextBrace);
      flushText();
      out.push(block);
    } else {
      textBuffer += content.slice(cursor, end + 1);
    }
    cursor = end + 1;
  }

  flushText();
  return out;
}

/**
 * Parses `trimmed` (already known to look like a JSON object or array) into content
 * blocks, but only when doing so actually produces structure worth having — a real
 * block type, or a single non-raw record.
 */
function tryParseNestedJsonTextBlock(trimmed: string): ContentBlock[] | null {
  try {
    const inner: unknown = JSON.parse(trimmed);
    if (!isRecord(inner) || typeof inner.type !== "string" || inner.type === "text") {
      return null;
    }
    const innerBlocks = parseContentBlocks([inner]);
    const first = innerBlocks[0];
    return first && first.kind !== "raw" ? innerBlocks : null;
  } catch {
    // Keep malformed nested JSON as plain text.
    return null;
  }
}

function tryParseJsonContentBlocks(trimmed: string): ContentBlock[] | null {
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const blocks = parseContentBlocks(parsed);
      return blocks.some((b) => b.kind !== "text" && b.kind !== "raw") ? blocks : null;
    }
    if (isRecord(parsed)) {
      const single = parseContentBlocks([parsed]);
      return single.length > 0 && single[0]!.kind !== "raw" ? single : null;
    }
    return null;
  } catch {
    // Fall through to the inline-blocks scanner.
    return null;
  }
}

function parseTextPart(obj: Record<string, unknown>): ContentBlock[] {
  const text = typeof obj.text === "string" ? obj.text : "";
  if (!text) return [];
  const trimmed = text.trim();
  const isBracedObject =
    trimmed.length > 0 && trimmed[0] === "{" && trimmed[trimmed.length - 1] === "}";
  if (isBracedObject && trimmed.includes('"type":"')) {
    const nestedBlocks = tryParseNestedJsonTextBlock(trimmed);
    if (nestedBlocks) return nestedBlocks;
  }
  return [{ kind: "text", text }];
}

function parseThinkingPart(obj: Record<string, unknown>): ContentBlock[] {
  const text =
    (typeof obj.thinking === "string" && obj.thinking) ||
    (typeof obj.text === "string" && obj.text) ||
    "";
  return text ? [{ kind: "thinking", text }] : [];
}

function parseToolUsePart(obj: Record<string, unknown>): ContentBlock[] {
  return [
    {
      kind: "tool_use",
      id: typeof obj.id === "string" ? obj.id : undefined,
      name: typeof obj.name === "string" ? obj.name : "tool",
      input: obj.input,
    },
  ];
}

function parseToolResultPart(obj: Record<string, unknown>): ContentBlock[] {
  return [
    {
      kind: "tool_result",
      toolUseId: typeof obj.tool_use_id === "string" ? obj.tool_use_id : undefined,
      content: obj.content,
      isError: obj.is_error === true,
    },
  ];
}

function parseMediaPart(obj: Record<string, unknown>): ContentBlock[] {
  const media = mediaPartToMediaData(obj);
  return media ? [{ kind: "media", part: media }] : [{ kind: "raw", data: obj }];
}

const MEDIA_PART_TYPES = new Set([
  "input_audio",
  "audio",
  "file",
  "binary",
  "image_url",
  "image",
  "video",
  "document",
]);

/** Parses one typed content-part record into the zero or more blocks it produces. */
function parseOneContentPart(obj: Record<string, unknown>): ContentBlock[] {
  const type = typeof obj.type === "string" ? obj.type : "";
  switch (type) {
    case "text":
      return parseTextPart(obj);
    case "thinking":
    case "reasoning":
      return parseThinkingPart(obj);
    case "tool_use":
      return parseToolUsePart(obj);
    case "tool_result":
      return parseToolResultPart(obj);
    default:
      return MEDIA_PART_TYPES.has(type) ? parseMediaPart(obj) : [{ kind: "raw", data: obj }];
  }
}

function parseStringContentBlocks(content: string): ContentBlock[] {
  if (content.length === 0) return [];
  const trimmed = content.trim();

  const looksLikeObject = trimmed.startsWith("{") && trimmed.endsWith("}");
  const looksLikeArray = trimmed.startsWith("[") && trimmed.endsWith("]");
  if (looksLikeObject || looksLikeArray) {
    const jsonBlocks = tryParseJsonContentBlocks(trimmed);
    if (jsonBlocks) {
      return jsonBlocks;
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

function parseArrayContentBlocks(content: unknown[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      if (part.length > 0) out.push({ kind: "text", text: part });
      continue;
    }
    if (!isRecord(part)) continue;
    out.push(...parseOneContentPart(part));
  }
  return out;
}

export function parseContentBlocks(content: ChatMessage["content"]): ContentBlock[] {
  if (content == null) return [];
  if (typeof content === "string") return parseStringContentBlocks(content);
  if (!Array.isArray(content)) {
    return isRecord(content) ? parseContentBlocks([content]) : [];
  }
  return parseArrayContentBlocks(content);
}
