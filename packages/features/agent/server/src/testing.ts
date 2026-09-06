import { agentSchema, type Agent } from "@langwatch/agent-contract";

/** The connected-agent state store, for another feature's test composing a realistic one. */
export { ConnectedAgentStateAdapter } from "./adapters/connected-agent-state.adapter.ts";

export function agentFixture(overrides: Partial<Agent> = {}): Agent {
  return agentSchema.parse({
    id: "agent_test",
    projectId: "project_test",
    name: "Test agent",
    type: "signature",
    config: { prompt: "Help the user" },
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  });
}
