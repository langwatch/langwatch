import type { SlackRepositories } from "../slack.repositories.ts";
import { MemorySlackConnectionClaimRepository } from "./memory.slack-connection-claim.repository.ts";
import { MemorySlackConnectionRepository } from "./memory.slack-connection.repository.ts";

export class MemorySlackRepositories {
  static readonly requires = [] as const;

  static create(): SlackRepositories {
    return {
      connections: MemorySlackConnectionRepository.create(),
      claims: MemorySlackConnectionClaimRepository.create(),
    };
  }
}
