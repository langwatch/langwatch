// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  type AgentStopClaim,
  type AgentStopClaimDecision,
  AgentStopClaimRepository,
} from "../agent-stop-claim.repository.ts";

type ClaimDatabase = Pick<PrismaClient, "agentStopClaim" | "$executeRaw">;

/**
 * The primary key (organizationId, agentId) is what refuses a second claim at the same moment.
 * The swap and the decision are SQL, so a writer parked on the row lock re-checks the committed row.
 */
export class PrismaAgentStopClaimRepository extends AgentStopClaimRepository {
  private constructor(private readonly prisma: ClaimDatabase) {
    super();
  }

  static create(prisma: ClaimDatabase): PrismaAgentStopClaimRepository {
    return new PrismaAgentStopClaimRepository(prisma);
  }

  async create({
    organizationId,
    agentId,
    stopId,
    claimedAt,
  }: {
    organizationId: string;
    agentId: string;
    stopId: string;
    claimedAt: number;
  }): Promise<boolean> {
    const { count } = await this.prisma.agentStopClaim.createMany({
      data: [{ organizationId, agentId, stopId, claimedAt: new Date(claimedAt) }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  async findClaims({
    organizationId,
    agentId,
  }: {
    organizationId: string;
    agentId: string;
  }): Promise<AgentStopClaim[]> {
    const rows = await this.prisma.agentStopClaim.findMany({
      where: { organizationId, agentId },
      select: { stopId: true, claimedAt: true, sentAt: true },
    });
    return rows.map((row) => ({
      stopId: row.stopId,
      claimedAt: row.claimedAt.getTime(),
      sentAt: row.sentAt ? row.sentAt.getTime() : null,
    }));
  }

  async markSent({
    organizationId,
    agentId,
    stopId,
    sentAt,
  }: {
    organizationId: string;
    agentId: string;
    stopId: string;
    sentAt: number;
  }): Promise<void> {
    await this.prisma.agentStopClaim.updateMany({
      where: { organizationId, agentId, stopId },
      data: { sentAt: new Date(sentAt) },
    });
  }

  async takeDecision({
    organizationId,
    stopId,
    decision,
    takenAt,
    abandonedBefore,
  }: {
    organizationId: string;
    stopId: string;
    decision: AgentStopClaimDecision;
    takenAt: number;
    abandonedBefore: number;
  }): Promise<boolean> {
    const count = await this.prisma.$executeRaw`
      ${skipTenantCheck({
        // The claim is addressed by its organisation and stop, both in the WHERE.
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "AgentStopClaim"
         SET "decision" = ${decision}, "decisionTakenAt" = ${new Date(takenAt)}
       WHERE "organizationId" = ${organizationId}
         AND "stopId" = ${stopId}
         AND ("decision" IS NULL OR "decisionTakenAt" < ${new Date(abandonedBefore)})
    `;
    return count === 1;
  }

  async releaseDecision({
    organizationId,
    stopId,
    decision,
    takenAt,
  }: {
    organizationId: string;
    stopId: string;
    decision: AgentStopClaimDecision;
    takenAt: number;
  }): Promise<void> {
    await this.prisma.agentStopClaim.updateMany({
      where: { organizationId, stopId, decision, decisionTakenAt: new Date(takenAt) },
      data: { decision: null, decisionTakenAt: null },
    });
  }

  async markDecisionSent({
    organizationId,
    stopId,
    decision,
    takenAt,
  }: {
    organizationId: string;
    stopId: string;
    decision: AgentStopClaimDecision;
    takenAt: number;
  }): Promise<void> {
    await this.prisma.agentStopClaim.updateMany({
      where: { organizationId, stopId, decision, decisionTakenAt: new Date(takenAt) },
      data: { decisionTakenAt: null },
    });
  }

  async swap({
    organizationId,
    agentId,
    fromStopId,
    toStopId,
    claimedAt,
    onlyIfUnsent,
  }: {
    organizationId: string;
    agentId: string;
    fromStopId: string;
    toStopId: string;
    claimedAt: number;
    onlyIfUnsent: boolean;
  }): Promise<boolean> {
    const count = await this.prisma.$executeRaw`
      ${skipTenantCheck({
        // The claim is addressed by its organisation and agent, both in the WHERE.
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "AgentStopClaim"
         SET "stopId" = ${toStopId}, "claimedAt" = ${new Date(claimedAt)},
             "sentAt" = NULL, "decision" = NULL, "decisionTakenAt" = NULL
       WHERE "organizationId" = ${organizationId}
         AND "agentId" = ${agentId}
         AND "stopId" = ${fromStopId}
         AND (${!onlyIfUnsent} OR "sentAt" IS NULL)
    `;
    return count === 1;
  }

  async release({
    organizationId,
    agentId,
    stopId,
  }: {
    organizationId: string;
    agentId: string;
    stopId: string;
  }): Promise<void> {
    await this.prisma.agentStopClaim.deleteMany({ where: { organizationId, agentId, stopId } });
  }
}
