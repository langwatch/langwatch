import { isRecord } from "./canonical-guard.rules.ts";
import { capPayloadString } from "./trace-payload-cap.rules.ts";

/** The display text one content block contributes, or "" when it contributes none. */
function contentBlockToText(block: unknown): string {
  if (typeof block === "string") return block;
  if (!isRecord(block)) return "";

  if (block.type === "text") return typeof block.text === "string" ? block.text : "";
  if (block.type === "tool_result") return contentToText(block.content);
  if (block.type === "tool_use" && typeof block.name === "string") {
    return `[tool_use: ${block.name}]`;
  }

  return "";
}

/**
 * Flatten one Anthropic message `content` to display text. Text/tool_result
 * blocks contribute their text; tool_use renders as `[tool_use: name]` so
 * the turn reads as conversation; thinking/images carry no text and drop.
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
    const text = contentBlockToText(block);
    if (text.length > 0) parts.push(text);
  }

  return parts.join("\n\n");
}

/**
 * The request's tool definitions as a compact system-side message: name and
 * first description line per tool — where MCP servers and skills show up in
 * what the session pays for. Previously the whole array was silently dropped.
 */
export function buildToolDefinitionsMessage(
  tools: unknown,
): { role: string; content: string } | null {
  if (!Array.isArray(tools)) {
    return null;
  }
  const lines = tools.map(formatToolDefinitionLine).filter((line): line is string => line !== null);
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
function formatToolDefinitionLine(tool: unknown): string | null {
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
