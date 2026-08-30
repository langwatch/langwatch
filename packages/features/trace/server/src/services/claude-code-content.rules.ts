import { capPayloadString } from "./trace-payload-cap.rules";
import { isRecord } from "./canonical-guard.rules";

/**
 * Flatten one Anthropic message `content` (string OR array of content blocks)
 * to display text. Text + tool_result blocks contribute their text; tool_use
 * blocks render as a compact `[tool_use: name]` marker so the turn reads as a
 * conversation rather than raw JSON; thinking blocks are redacted by Anthropic
 * and images carry no text, so both are dropped.
 */
export function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      if (block.length > 0) {
        parts.push(block);
      }
      continue;
    }
    if (!isRecord(block)) {
      continue;
    }
    const b = block;
    if (b.type === "text" && typeof b.text === "string") {
      if (b.text.length > 0) {
        parts.push(b.text);
      }
    } else if (b.type === "tool_result") {
      const nested = contentToText(b.content);
      if (nested.length > 0) {
        parts.push(nested);
      }
    } else if (b.type === "tool_use" && typeof b.name === "string") {
      parts.push(`[tool_use: ${b.name}]`);
    }
  }
  return parts.join("\n\n");
}

/**
 * The request's tool definitions as a compact system-side message: name and
 * first description line per tool. This is where MCP servers and skills show
 * up in what the session actually pays for, a request with 40 tools is 40
 * schemas of context on every call, and until now the whole array was
 * silently dropped.
 */
export function toolDefinitionsMessage(tools: unknown): { role: string; content: string } | null {
  if (!Array.isArray(tools)) {
    return null;
  }
  const lines = tools.map(toolDefinitionLine).filter((line): line is string => line !== null);
  if (lines.length === 0) {
    return null;
  }
  return {
    role: "system",
    content: capPayloadString(
      `[tools available: ${lines.length}]\n${lines.join("\n")}`,
      void 0,
      "tool_definitions",
    ),
  };
}

/** One tool as `name: first description line`, or null if it has no name. */
function toolDefinitionLine(tool: unknown): string | null {
  if (!isRecord(tool)) {
    return null;
  }
  const { name, description } = tool;
  if (typeof name !== "string" || name.length === 0) {
    return null;
  }
  let summary = "";
  if (typeof description === "string") {
    summary = (description.split("\n", 1)[0] ?? "").trim();
  }
  return summary ? `${name}: ${summary}` : name;
}
