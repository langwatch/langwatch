import type { SessionStateStore } from "@langwatch/redis-client/session-state";

import type { AgentRepository } from "./agent.repository.ts";

export interface AgentRepositories {
  readonly agents: AgentRepository;
  /** The connected-agent relay's shared session state, across replicas. */
  readonly sessionState: SessionStateStore;
}
