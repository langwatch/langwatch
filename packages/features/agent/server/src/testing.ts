import { agentSchema, type Agent } from "@langwatch/agent-contract";
import { Temporal, toDate } from "@langwatch/time";

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
    createdAt: toDate(Temporal.Instant.fromEpochMilliseconds(0)),
    updatedAt: toDate(Temporal.Instant.fromEpochMilliseconds(0)),
    ...overrides,
  });
}
