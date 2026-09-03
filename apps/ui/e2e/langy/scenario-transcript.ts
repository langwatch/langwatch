// Reading answers back out of a finished scenario run.
//
// Structural assertions need the reply as plain text — "does this contain a
// digit", "does this leak an API key", "what did Langy actually say when the
// judge failed it". Both scenario suites need that, so the flattening lives
// here rather than in whichever file happened to need it first.

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
  return content
    .map((part) =>
      typeof part === "string"
        ? part
        : typeof (part as { text?: unknown })?.text === "string"
          ? (part as { text: string }).text
          : "",
    )
    .join("")
    .trim();
}

function assistantMessages(result: ScenarioResult): Array<Record<string, unknown>> {
  const messages = (result as { messages?: Array<Record<string, unknown>> }).messages ?? [];
  return messages.filter((msg) => msg?.role === "assistant");
}

/**
 * The prose view of one assistant message. Tool traffic never rides in
 * assistant text (langy-agent.ts returns it as role:"tool" messages), and a
 * tool-call-only assistant message flattens to "" here, so these helpers see
 * only what Langy itself said.
 */
function proseOf(content: unknown): string {
  return flattenContent(content).trim();
}

/**
 * Every assistant reply in the run, flattened and newline-joined.
 *
 * Use this for anything that must hold across the WHOLE conversation — a
 * credential must not appear in any reply, not merely in the final one. A
 * multi-turn script that only inspects the last reply passes a run that leaked
 * on turn one and recovered on turn two.
 */
export function allAssistantText(result: ScenarioResult): string {
  return assistantMessages(result)
    .map((msg) => proseOf(msg.content))
    .filter((text) => text.length > 0)
    .join("\n");
}

/**
 * Flattens the last assistant message to plain text.
 *
 * Returns "" when there is no assistant message at all — which is itself a
 * finding, and the empty-turn scenario asserts on it directly.
 */
export function lastAssistantText(result: ScenarioResult): string {
  const assistants = assistantMessages(result);
  const last = assistants[assistants.length - 1];
  return last ? proseOf(last.content) : "";
}
