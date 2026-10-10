import type { SlackConnectionClaimRepository } from "./slack-connection-claim.repository.ts";
import type { SlackConnectionRepository } from "./slack-connection.repository.ts";

export interface SlackRepositories {
  readonly connections: SlackConnectionRepository;
  readonly claims: SlackConnectionClaimRepository;
}
