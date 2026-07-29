import { type CodingAgentDefinition, signalSays } from "./_types";

/**
 * Codex. Uses whatever `service_name` it was configured with — there is no
 * stable scope string — so the record NAME (`codex.*`) is the signal.
 * Has no lines-of-code and no cost metric at all; its cost must be priced
 * from tokens, so there is nothing more to map here.
 */
export const codexAgent: CodingAgentDefinition = {
  id: "codex",
  matches: (signal) => signalSays(signal, "codex"),
  namePrefixes: ["codex."],

  eventAliases: {
    // Codex names its shell outcome differently but means "the tool ran".
    sandbox_outcome: "tool_result",
  },

  metricAliases: {
    // Codex spells its token metric differently, and reports it per turn.
    "turn.token_usage": "token_usage",
  },
};
