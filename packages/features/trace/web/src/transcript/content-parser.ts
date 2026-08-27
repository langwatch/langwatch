import type { ChatMessage, ContentBlock } from "./types";
import { mediaPartToMediaData } from "./media-part";
import { isRecord } from "./record";

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
      const parsed: unknown = JSON.parse(slice);
      if (isRecord(parsed) && typeof parsed.type === "string") {
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
      // Keep malformed inline objects as text.
    }

    if (!consumed) {
      textBuffer += content.slice(cursor, end + 1);
    }
    cursor = end + 1;
  }

  flushText();
  return out;
}

export function parseContentBlocks(content: ChatMessage["content"]): ContentBlock[] {
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
          if (blocks.some((b) => b.kind !== "text" && b.kind !== "raw")) {
            return blocks;
          }
        } else if (isRecord(parsed)) {
          const single = parseContentBlocks([parsed]);
          if (single.length > 0 && single[0]!.kind !== "raw") {
            return single;
          }
        }
      } catch {
        // Fall through to the inline-blocks scanner.
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

    const obj = part;
    const type = typeof obj.type === "string" ? obj.type : "";
    switch (type) {
      case "text": {
        const text = typeof obj.text === "string" ? obj.text : "";
        if (!text) break;
        const trimmed = text.trim();
        if (
          trimmed.length > 0 &&
          trimmed[0] === "{" &&
          trimmed[trimmed.length - 1] === "}" &&
          trimmed.includes('"type":"')
        ) {
          try {
            const inner: unknown = JSON.parse(trimmed);
            if (isRecord(inner) && typeof inner.type === "string" && inner.type !== "text") {
              const innerBlocks = parseContentBlocks([inner]);
              const first = innerBlocks[0];
              if (first && first.kind !== "raw") {
                out.push(...innerBlocks);
                break;
              }
            }
          } catch {
            // Keep malformed nested JSON as plain text.
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
          toolUseId: typeof obj.tool_use_id === "string" ? obj.tool_use_id : undefined,
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
  return out;
}
