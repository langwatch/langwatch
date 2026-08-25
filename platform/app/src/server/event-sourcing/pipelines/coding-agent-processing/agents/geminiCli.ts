import { type CodingAgentDefinition, signalSays } from "./_types";

/**
 * Gemini CLI. Matches on `gemini_cli` and bare `gemini`. Its `tool` token
 * type (tokens spent on tool DEFINITIONS, already inside the input count)
 * and `total` bucket are excluded in the engine's shared token folding.
 */
export const geminiCliAgent: CodingAgentDefinition = {
  id: "gemini_cli",
  matches: (signal) => signalSays(signal, "gemini_cli") || signalSays(signal, "gemini"),
  namePrefixes: ["gemini_cli."],

  eventAliases: {
    // Gemini logs a COMPLETED tool call (it carries success + duration_ms),
    // which is our tool_result, not a separate "the tool was requested" fact.
    tool_call: "tool_result",
    chat_compression: "compaction",
  },

  metricAliases: {
    // Gemini: `gemini_cli.lines.changed` with type=added|removed.
    "lines.changed": "lines_of_code",
  },
};
