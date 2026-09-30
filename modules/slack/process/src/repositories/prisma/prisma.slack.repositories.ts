import type { SlackRepositories } from "../slack.repositories.ts";
import {
  PrismaSlackConnectionClaimRepository,
  type SlackConnectionClaimDatabase,
} from "./prisma.slack-connection-claim.repository.ts";
import {
  PrismaSlackConnectionRepository,
  type SlackConnectionDatabase,
} from "./prisma.slack-connection.repository.ts";

/** Every model the live tier reads, and nothing else. */
export type SlackLiveDatabase = SlackConnectionDatabase & SlackConnectionClaimDatabase;

export class PrismaSlackRepositories {
  static readonly requires = ["prisma"] as const;

  static create(members: Readonly<{ prisma: SlackLiveDatabase }>): SlackRepositories {
    return {
      connections: PrismaSlackConnectionRepository.create(members.prisma),
      claims: PrismaSlackConnectionClaimRepository.create(members.prisma),
    };
  }
}
