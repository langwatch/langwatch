import type { AgentRepositories } from "../agent.repositories.ts";
import { MemoryAgentRepository } from "./memory.agent.repository.ts";

export class MemoryAgentRepositories {
  static readonly requires = [] as const;

  static create(): AgentRepositories {
    return { agents: MemoryAgentRepository.create() };
  }
}
