import type { AgentRepository } from "./agent.repository.ts";

export interface AgentRepositories {
  readonly agents: AgentRepository;
}
