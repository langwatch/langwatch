import type { Span, SpanInputOutput } from "./trace-format.schemas.ts";

/**
 * The text one system-instruction entry contributes: the entry itself when it
 * is a string, otherwise the `content` (or `text`) of a content block. An entry
 * carrying neither contributes nothing.
 */
function instructionEntryText(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const block = entry as Record<string, unknown>;
  const text = block.content ?? block.text;
  return typeof text === "string" ? text : null;
}

/** Content blocks read as one prompt, or null when none of them carry text. */
function joinInstructionEntries(entries: unknown[]): string | null {
  const parts: string[] = [];
  for (const entry of entries) {
    const text = instructionEntryText(entry);
    if (text !== null) parts.push(text);
  }
  const joined = parts.join("\n");
  return joined.trim().length > 0 ? joined : null;
}

/**
 * One `gen_ai.system_instructions` value as a prompt. The semconv writes it as
 * a plain string, as an array of content blocks (`{ type, content }`), or, when
 * the transport cannot carry structured values, as that array JSON-encoded, and
 * the canonicaliser folds the blocks into text the same way. Anything else, and
 * an array with no text in it, reads as no prompt.
 */
function systemInstructionsText(value: unknown): string | null {
  if (Array.isArray(value)) return joinInstructionEntries(value);
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const looksLikeJsonArray = value.trimStart().startsWith("[");
  if (!looksLikeJsonArray) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? joinInstructionEntries(parsed) : value;
  } catch {
    return value;
  }
}

/**
 * Read system instructions from OTel split `gen_ai.system_instructions`,
 * tolerating both flat-dotted and nested shapes. Matches drawable prompt.
 */
export function readSystemInstructions(
  params: Record<string, unknown> | null | undefined,
): string | null {
  if (!params) return null;
  const flat = systemInstructionsText(params["gen_ai.system_instructions"]);
  if (flat !== null) return flat;
  const genAi = params.gen_ai;
  if (genAi && typeof genAi === "object" && !Array.isArray(genAi)) {
    return systemInstructionsText((genAi as Record<string, unknown>).system_instructions);
  }
  return null;
}

/**
 * Build display input by recombining system instructions with the chat
 * transcript, keeping stored attributes semconv-correct while all view modes
 * stay consistent.
 */
export function buildDisplayInput(span: Pick<Span, "input" | "params">): string | null {
  const io = span.input;
  if (io && io.type === "chat_messages" && Array.isArray(io.value)) {
    const system = readSystemInstructions(span.params ?? null);
    const alreadyHasSystem = io.value.some(
      (m) => !!m && typeof m === "object" && "role" in m && m.role === "system",
    );
    if (system && !alreadyHasSystem) {
      return JSON.stringify([{ role: "system", content: system }, ...io.value]);
    }
  }
  return stringifySpanIO(io);
}

/**
 * Renders a canonical captured value as the single string the v2 drawer shows
 * and edits. Pure and dependency-free so the client applies a correction with
 * exactly the same rendering the server used for the original.
 */
export function stringifySpanIO(io: SpanInputOutput | null | undefined): string | null {
  if (!io) return null;
  switch (io.type) {
    case "text":
      return String(io.value);
    case "chat_messages":
      return JSON.stringify(io.value);
    case "json":
      return JSON.stringify(io.value);
    case "raw":
      return String(io.value);
    case "guardrail_result":
    case "evaluation_result":
      return JSON.stringify(io.value);
    case "list":
      return io.value.map((v) => stringifySpanIO(v)).join("\n");
    default:
      return null;
  }
}
