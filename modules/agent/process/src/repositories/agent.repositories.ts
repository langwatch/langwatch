import type { AgentRepository } from "./agent.repository.ts";
import type { ConnectedAgentStateRepository } from "./connected-agent-state.repository.ts";

export interface AgentRepositories {
  readonly agents: AgentRepository;
  /** The connected-agent relay's shared state, across replicas. */
  readonly connectedAgentState: ConnectedAgentStateRepository;
}
