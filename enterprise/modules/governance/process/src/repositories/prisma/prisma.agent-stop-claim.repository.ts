// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { type AgentStopClaim, AgentStopClaimRepository } from "../agent-stop-claim.repository.ts";

type ClaimDatabase = Pick<PrismaClient, "agentStopClaim">;

/** The primary key (organizationId, agentId) is what refuses a second claim at the same moment. */
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
      select: { stopId: true, claimedAt: true },
    });
    return rows.map((row) => ({ stopId: row.stopId, claimedAt: row.claimedAt.getTime() }));
  }

  async swap({
    organizationId,
    agentId,
    fromStopId,
    toStopId,
    claimedAt,
  }: {
    organizationId: string;
    agentId: string;
    fromStopId: string;
    toStopId: string;
    claimedAt: number;
  }): Promise<boolean> {
    const { count } = await this.prisma.agentStopClaim.updateMany({
      where: { organizationId, agentId, stopId: fromStopId },
      data: { stopId: toStopId, claimedAt: new Date(claimedAt) },
    });
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
