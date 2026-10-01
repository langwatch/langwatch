import { type CodingAgentDefinition, signalSays } from "./coding-agent-definition.ts";

/**
 * GitHub Copilot CLI: namespaces under the ORG, not the product
 * (`github.copilot.`). Emits lifecycle events as SPAN EVENTS, not log
 * records; the aliases below fold them the same way if they ever arrive as logs.
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
