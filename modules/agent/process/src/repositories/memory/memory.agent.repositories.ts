import type { AgentRepositories } from "../agent.repositories.ts";
import { MemoryAgentRepository } from "./memory.agent.repository.ts";
import { MemoryConnectedAgentStateRepository } from "./memory.connected-agent-state.repository.ts";

export class MemoryAgentRepositories {
  static readonly requires = [] as const;

  static create(): AgentRepositories {
    return {
      agents: MemoryAgentRepository.create(),
      connectedAgentState: MemoryConnectedAgentStateRepository.create(),
    };
  }
}
