import { mediaPartToMediaData } from "../trace-media-part.collector.ts";
import { parseJSON } from "./content-format.ts";
import { isRecord } from "./record.ts";
import type { ChatMessage, ContentBlock } from "./types.ts";

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

function parseInlineCandidate(slice: string): ContentBlock | null {
  if (!slice.includes('"type":')) return null;

  try {
    const parsed: unknown = JSON.parse(slice);
    if (!isRecord(parsed) || typeof parsed.type !== "string") return null;

    const block = parseContentBlocks([parsed])[0];
    return block && block.kind !== "raw" ? block : null;
  } catch {
    return null;
  }
}

type InlineCandidate = {
  block: ContentBlock | null;
  nextCursor: number;
  text: string;
  done: boolean;
};

function nextInlineCandidate(content: string, cursor: number): InlineCandidate {
  const nextBrace = content.indexOf("{", cursor);
  if (nextBrace === -1) {
    return { block: null, nextCursor: content.length, text: content.slice(cursor), done: true };
  }

  const end = findJsonObjectEnd(content, nextBrace);
  if (end === -1) {
    return { block: null, nextCursor: content.length, text: content.slice(cursor), done: true };
  }

  const nextCursor = end + 1;
  const slice = content.slice(nextBrace, nextCursor);
  const block = parseInlineCandidate(slice);
  const text = block ? content.slice(cursor, nextBrace) : content.slice(cursor, nextCursor);

  return { block, nextCursor, text, done: false };
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
    const candidate = nextInlineCandidate(content, cursor);
    textBuffer += candidate.text;
    cursor = candidate.nextCursor;

    if (candidate.block) {
      flushText();
      out.push(candidate.block);
    }

    if (candidate.done) break;
  }

  flushText();
  return out;
}

/**
 * Parse trimmed JSON into content blocks only when structure is worth having.
 */
function parseNestedJsonTextBlock(trimmed: string): ContentBlock[] | null {
  // Malformed nested JSON is not a failure here: it stays plain text.
  const inner = parseJSON(trimmed);
  if (!isRecord(inner) || typeof inner.type !== "string" || inner.type === "text") {
    return null;
  }
  const innerBlocks = parseContentBlocks([inner]);
  const first = innerBlocks[0];
  return first && first.kind !== "raw" ? innerBlocks : null;
}

function parseJsonContentBlocks(trimmed: string): ContentBlock[] | null {
  // A string that is not JSON falls through to the inline-blocks scanner.
  const parsed = parseJSON(trimmed);
  if (Array.isArray(parsed)) {
    const blocks = parseContentBlocks(parsed);
    return blocks.some((b) => b.kind !== "text" && b.kind !== "raw") ? blocks : null;
  }
  if (isRecord(parsed)) {
    const single = parseContentBlocks([parsed]);
    return single.length > 0 && single[0]!.kind !== "raw" ? single : null;
  }
  return null;
}

function parseStringContentBlocks(content: string): ContentBlock[] {
  if (content.length === 0) return [];
  const trimmed = content.trim();

  const looksLikeObject = trimmed.startsWith("{") && trimmed.endsWith("}");
  const looksLikeArray = trimmed.startsWith("[") && trimmed.endsWith("]");
  if (looksLikeObject || looksLikeArray) {
    const jsonBlocks = parseJsonContentBlocks(trimmed);
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

function appendTextPart(out: ContentBlock[], obj: Record<string, unknown>): void {
  const text = typeof obj.text === "string" ? obj.text : "";
  if (!text) return;
  const trimmed = text.trim();
  const isBracedObject =
    trimmed.length > 0 && trimmed[0] === "{" && trimmed[trimmed.length - 1] === "}";
  if (isBracedObject && trimmed.includes('"type":"')) {
    const nestedBlocks = parseNestedJsonTextBlock(trimmed);
    if (nestedBlocks) {
      out.push(...nestedBlocks);
      return;
    }
  }
  out.push({ kind: "text", text });
}

function appendContentPart(out: ContentBlock[], obj: Record<string, unknown>): void {
  switch (obj.type) {
    case "text": {
      appendTextPart(out, obj);
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
        id: typeof obj.id === "string" ? obj.id : void 0,
        name: typeof obj.name === "string" ? obj.name : "tool",
        input: obj.input,
      });
      break;
    }
    case "tool_result": {
      out.push({
        kind: "tool_result",
        toolUseId: typeof obj.tool_use_id === "string" ? obj.tool_use_id : void 0,
        content: obj.content,
        isError: obj.is_error === true,
      });
      break;
    }
    case "input_audio":
    case "audio":
    case "file":
    case "binary":
    case "image_url":
    case "image":
    case "video":
    case "document": {
      const media = mediaPartToMediaData(obj);
      if (media) {
        out.push({ kind: "media", part: media });
        break;
      }
      out.push({ kind: "raw", data: obj });
      break;
    }
    default:
      out.push({ kind: "raw", data: obj });
  }
}

export function parseContentBlocks(content: ChatMessage["content"]): ContentBlock[] {
  if (content == null) return [];
  if (typeof content === "string") {
    return parseStringContentBlocks(content);
  }
  if (!Array.isArray(content)) {
    if (isRecord(content)) {
      return parseContentBlocks([content]);
    }
    return [];
  }

  const out: ContentBlock[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      if (part.length > 0) out.push({ kind: "text", text: part });
      continue;
    }
    if (!isRecord(part)) continue;

    appendContentPart(out, part);
  }
  return out;
}
