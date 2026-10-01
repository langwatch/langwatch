// Reading answers back out of a finished scenario run.

import type { runScenarioAndLog } from "./scenario-logger";

export type ScenarioResult = Awaited<ReturnType<typeof runScenarioAndLog>>;

/**
 * `content` carries either a string or an array of parts depending on how the
 * adapter returned, so both shapes are handled here rather than at each call
 * site.
 */
function flattenContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map(textOfPart).join("").trim();
}

function textOfPart(part: unknown): string {
  if (typeof part === "string") return part;
  if (typeof part !== "object" || part === null || !("text" in part)) return "";
  return typeof part.text === "string" ? part.text : "";
}

function assistantMessages(result: ScenarioResult): Record<string, unknown>[] {
  const messages = (result as { messages?: Record<string, unknown>[] }).messages ?? [];
  return messages.filter((msg) => msg?.role === "assistant");
}

/**
 * The prose view of one assistant message. Tool traffic never rides in assistant text
 * (langy-agent.ts returns it as role:"tool" messages), and a tool-call-only assistant
 * message flattens to "" here, so these helpers see only what Langy itself said.
 */
function proseOf(content: unknown): string {
  return flattenContent(content).trim();
}

/**
 * Every assistant reply in the run, flattened and newline-joined.
 */
export function allAssistantText(result: ScenarioResult): string {
  return assistantMessages(result)
    .map((msg) => proseOf(msg.content))
    .filter((text) => text.length > 0)
    .join("\n");
}

/**
 * Flattens the last assistant message to plain text.
 */
export function lastAssistantText(result: ScenarioResult): string {
  const assistants = assistantMessages(result);
  const last = assistants[assistants.length - 1];
  return last ? proseOf(last.content) : "";
}
