import { convertTo } from "@langwatch/dataset-contract";
import { extractChunkTextualContent } from "@langwatch/trace-contract";

/**
 * Mapped contexts as the texts langevals reads: a RAG chunk object, often
 * JSON-encoded, contributes its content, not its envelope. Empty entries are
 * dropped, so an unmapped field is an empty list, not one empty context.
 */
export function toLangevalsContexts(value: unknown): string[] | undefined {
  const decoded = convertTo(value, "array");
  if (decoded === undefined) return undefined;
  const items: unknown[] = Array.isArray(decoded) ? decoded : [decoded];
  return items.map(contextText).filter((text) => text.length > 0);
}

function contextText(item: unknown): string {
  if (typeof item === "string") {
    const chunk = parseChunk(item);
    return chunk === undefined ? item.trim() : contextText(chunk);
  }
  if (item === null || item === undefined) return "";
  if (typeof item === "object" && !Array.isArray(item) && "content" in item) {
    const { content } = item;
    return typeof content === "string" ? content.trim() : extractChunkTextualContent(content);
  }
  if (typeof item === "object") return JSON.stringify(item);
  return typeof item === "number" || typeof item === "boolean" ? String(item) : "";
}

/** A JSON-encoded chunk object, when the string is one. */
function parseChunk(text: string): object | undefined {
  if (!text.trimStart().startsWith("{")) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    const isChunk = typeof parsed === "object" && parsed !== null && "content" in parsed;
    return isChunk ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A mapped conversation as langevals' turns. A mapping that resolves to nothing arrives as "",
 * which `convertTo` wraps as one empty turn and langevals refuses (a 422 on every run), so empty
 * strings are dropped: an unmapped conversation is an empty list, like unmapped contexts.
 */
export function toLangevalsConversation(value: unknown): unknown[] | undefined {
  const decoded = convertTo(value, "array");
  if (decoded === undefined) return undefined;
  const turns: unknown[] = Array.isArray(decoded) ? decoded : [decoded];

  return turns.filter((turn) => !(typeof turn === "string" && turn.trim() === ""));
}
