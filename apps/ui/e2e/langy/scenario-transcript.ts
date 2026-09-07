// Reading answers back out of a finished scenario run.

import type { runScenarioAndLog } from "./scenario-logger";

export type ScenarioResult = Awaited<ReturnType<typeof runScenarioAndLog>>;

/**
 * `content` carries either a string or an array of parts depending on how the
 * adapter returned, so both shapes are handled here rather than at each call
 * site.
 */
/** The text of one content part, whichever of the two shapes it arrived in. */
function partText(part: unknown): string {
  if (typeof part === "string") return part;
  const text = (part as { text?: unknown })?.text;
  return typeof text === "string" ? text : "";
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => partText(part))
    .join("")
    .trim();
}

function assistantMessages(result: ScenarioResult): Array<Record<string, unknown>> {
  const messages = (result as { messages?: Array<Record<string, unknown>> }).messages ?? [];
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
