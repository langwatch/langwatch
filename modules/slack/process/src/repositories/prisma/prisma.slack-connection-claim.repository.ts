import { skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaTables } from "@langwatch/prisma-client/ownership";
import { z } from "zod";

import {
  SlackConnectionClaimRepository,
  type SlackConnectionClaimKey,
  type SlackConnectionClaimRow,
} from "../slack-connection-claim.repository.ts";

/** Only the model this repository touches. */
export type SlackConnectionClaimDatabase = Pick<PrismaClient, "slackConnectionClaim" | "$queryRaw">;

const claimSelect = {
  connectionId: true,
  claimantId: true,
  claimantLabel: true,
  organizationId: true,
  projectId: true,
} as const;

const claimRowsSchema = z.array(
  z.object({
    connectionId: z.string(),
    claimantId: z.string(),
    claimantLabel: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
  }),
);

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

  /** Every organization's claims: the claimant's release sweep pages the whole table. */
  async findPage({
    after,
    limit,
  }: {
    after?: SlackConnectionClaimKey;
    limit: number;
  }): Promise<SlackConnectionClaimRow[]> {
    const afterConnectionId = after?.connectionId ?? null;
    const afterClaimantId = after?.claimantId ?? null;
    const rows = await this.prisma.$queryRaw<unknown[]>`
      SELECT "connectionId", "claimantId", "claimantLabel", "organizationId", "projectId"
      FROM "slack_connection_claim"
      WHERE ${afterConnectionId}::text IS NULL
         OR ("connectionId", "claimantId") > (${afterConnectionId}::text, ${afterClaimantId}::text)
      ORDER BY "connectionId" ASC, "claimantId" ASC
      LIMIT ${limit}
      ${skipTenantCheck({
        // Slack claim reconcile cross-tenant sweep (upgrade step, worker)
        SKIP_TENANT_CHECK: true,
      })}
    `;
    return claimRowsSchema.parse(rows);
  }
}
