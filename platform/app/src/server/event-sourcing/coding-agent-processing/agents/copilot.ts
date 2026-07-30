import { type CodingAgentDefinition, signalSays } from "./_types";

/**
 * GitHub Copilot CLI. Namespaces under the ORG, not the product
 * (`github.copilot.`). Emits its lifecycle events as SPAN EVENTS rather
 * than log records; the aliases below map them so they fold the same way
 * if they ever arrive as logs.
 */
export const copilotAgent: CodingAgentDefinition = {
  id: "copilot",
  matches: (signal) => signalSays(signal, "copilot"),
  // Longest first: `github.copilot.` must strip before bare `copilot.`.
  namePrefixes: ["github.copilot.", "copilot."],

  eventAliases: {
    session_compaction_complete: "compaction",
    skill_invoked: "skill_activated",
  },
};
