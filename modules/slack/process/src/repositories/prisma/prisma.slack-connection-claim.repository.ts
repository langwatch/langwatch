import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaTables } from "@langwatch/prisma-client/ownership";

import {
  SlackConnectionClaimRepository,
  type SlackConnectionClaimRow,
} from "../slack-connection-claim.repository.ts";

/** Only the model this repository touches. */
export type SlackConnectionClaimDatabase = Pick<PrismaClient, "slackConnectionClaim">;

const claimSelect = {
  connectionId: true,
  claimantId: true,
  claimantLabel: true,
  organizationId: true,
  projectId: true,
} as const;

export class PrismaSlackConnectionClaimRepository extends SlackConnectionClaimRepository {
  static readonly tables = prismaTables("SlackConnectionClaim");

  private constructor(private readonly prisma: SlackConnectionClaimDatabase) {
    super();
  }

  static create(prisma: SlackConnectionClaimDatabase): PrismaSlackConnectionClaimRepository {
    return new PrismaSlackConnectionClaimRepository(prisma);
  }

  async upsert(claim: SlackConnectionClaimRow): Promise<void> {
    await this.prisma.slackConnectionClaim.upsert({
      where: {
        connectionId_claimantId: {
          connectionId: claim.connectionId,
          claimantId: claim.claimantId,
        },
      },
      create: claim,
      update: { claimantLabel: claim.claimantLabel, projectId: claim.projectId },
    });
  }

  async delete({
    connectionId,
    claimantId,
    projectId,
  }: {
    connectionId: string;
    claimantId: string;
    projectId: string;
  }): Promise<void> {
    await this.prisma.slackConnectionClaim.deleteMany({
      where: { connectionId, claimantId, projectId },
    });
  }

  async findByConnections({
    organizationId,
    ids,
    exceptProjectId,
  }: {
    organizationId: string;
    ids: string[];
    exceptProjectId?: string;
  }): Promise<SlackConnectionClaimRow[]> {
    if (ids.length === 0) return [];
    return this.prisma.slackConnectionClaim.findMany({
      where: {
        organizationId,
        connectionId: { in: ids },
        ...(exceptProjectId === undefined ? {} : { projectId: { not: exceptProjectId } }),
      },
      orderBy: [{ createdAt: "asc" }, { claimantId: "asc" }],
      select: claimSelect,
    });
  }
}
