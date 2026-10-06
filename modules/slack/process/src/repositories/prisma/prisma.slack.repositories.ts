import type { Encryption } from "@langwatch/process-stores";

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
  static readonly requires = ["prisma", "encryption"] as const;

  static create(
    members: Readonly<{ prisma: SlackLiveDatabase; encryption: Encryption }>,
  ): SlackRepositories {
    return {
      connections: PrismaSlackConnectionRepository.create({
        prisma: members.prisma,
        encryption: members.encryption,
      }),
      claims: PrismaSlackConnectionClaimRepository.create(members.prisma),
    };
  }
}
