// An agent under test that refuses everything.
import { AgentRole, type AgentAdapter } from "@langwatch/scenario";

export const owaspTargetAdapter: AgentAdapter = {
  role: AgentRole.AGENT,
  call: async () => "I can only help with your own orders.",
};
