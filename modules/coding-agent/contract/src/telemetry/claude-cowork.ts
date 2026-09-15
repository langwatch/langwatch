import { type CodingAgentDefinition, signalSays } from "./coding-agent-definition.ts";

// Claude Cowork (Claude desktop in VM) shares Claude Code's event vocabulary
// but has unique service.name; registered first to win scope over claude_code.
export const claudeCoworkAgent: CodingAgentDefinition = {
  id: "claude_cowork",
  matches: (signal) => signalSays(signal, "cowork"),
  namePrefixes: ["claude_cowork.", "cowork."],
  // Cowork exports events over the logs protocol; spans only via a beta
  // flag. The session fold folds its model calls and tool runs from events.
  logsOnly: true,
};
