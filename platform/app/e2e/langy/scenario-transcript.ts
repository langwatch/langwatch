// Reading answers back out of a finished scenario run.
//
// Structural assertions need the reply as plain text — "does this contain a
// digit", "does this leak an API key", "what did Langy actually say when the
// judge failed it". Both scenario suites need that, so the flattening lives
// here rather than in whichever file happened to need it first.

import type { runScenarioAndLog } from "./scenario-logger";

export type ScenarioResult = Awaited<ReturnType<typeof runScenarioAndLog>>;

/**
 * Flattens the last assistant message to plain text.
 *
 * `result.messages` carries either a string or an array of parts depending on
 * how the adapter returned, so both shapes are handled here rather than at each
 * call site. Returns "" when there is no assistant message at all — which is
 * itself a finding, and the empty-turn scenario asserts on it directly.
 */
export function lastAssistantText(result: ScenarioResult): string {
  const messages =
    (result as { messages?: Array<Record<string, unknown>> }).messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "assistant") continue;
    const { content } = msg;
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) {
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
  }
  return "";
}
