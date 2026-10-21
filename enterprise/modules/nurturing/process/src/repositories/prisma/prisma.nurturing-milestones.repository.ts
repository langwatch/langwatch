// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository } from "@langwatch/prisma-client";

import type {
  NurturingCodingMilestonesRepository,
  NurturingMilestonesRepository,
  NurturingOrganizationCounts,
  NurturingOrganizationRow,
} from "../nurturing-milestones.repository.ts";

const ORGANIZATION_STATE = {
  organizationId: true,
  adminUserId: true,
  seeded: true,
  evaluationCount: true,
  simulationRunCount: true,
} as const;

const ORGANIZATION_ROW = {
  ...ORGANIZATION_STATE,
  codingFirstSessionAt: true,
  codingAgentTypes: true,
  codingActiveDays: true,
  codingLastActiveDay: true,
} as const;

/** Nurturing's organizations, the one table it claims; the owners' rows are read elsewhere (R40). */
export class PrismaNurturingMilestonesRepository
  extends PrismaRepository.for("NurturingOrganization")
  implements NurturingMilestonesRepository, NurturingCodingMilestonesRepository
{
  static readonly create = this.factory(
    (prisma) => new PrismaNurturingMilestonesRepository(prisma),
  );

  async recordOrganization({
    organizationId,
    adminUserId,
    seeded,
  }: Parameters<NurturingMilestonesRepository["recordOrganization"]>[0]): Promise<void> {
    // ON CONFLICT DO NOTHING: a concurrent create never raises (so never logs) a P2002.
    await this.prisma.nurturingOrganization.createMany({
      data: [{ organizationId, adminUserId, seeded }],
      skipDuplicates: true,
    });
    if (adminUserId)
      await this.prisma.nurturingOrganization.updateMany({
        where: { organizationId },
        data: { adminUserId },
      });
  }

  countEvaluation({
    organizationId,
    by,
  }: Readonly<{ organizationId: string; by: number }>): Promise<NurturingOrganizationCounts[]> {
    return this.count({ organizationId, data: { evaluationCount: { increment: by } } });
  }

  countSimulationRun({
    organizationId,
    by,
  }: Readonly<{ organizationId: string; by: number }>): Promise<NurturingOrganizationCounts[]> {
    return this.count({ organizationId, data: { simulationRunCount: { increment: by } } });
  }

  async findOrganization({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<NurturingOrganizationRow[]> {
    const organization = await this.prisma.nurturingOrganization.findUnique({
      where: { organizationId },
      select: ORGANIZATION_ROW,
    });
    if (!organization) return [];
    return [
      {
        ...organization,
        codingFirstSessionAt: organization.codingFirstSessionAt?.getTime() ?? null,
      },
    ];
  }

  // The three coding writes are one conditional updateMany each: Postgres re-checks the WHERE
  // under the row lock, so concurrent writers change the row once.
  async recordCodingFirstSession({
    organizationId,
    occurredAt,
  }: Parameters<NurturingCodingMilestonesRepository["recordCodingFirstSession"]>[0]): Promise<{
    first: boolean;
  }> {
    const { count } = await this.prisma.nurturingOrganization.updateMany({
      where: { organizationId, codingFirstSessionAt: null },
      data: { codingFirstSessionAt: new Date(occurredAt) },
    });
    if (count === 1) return { first: true };
    // A retry of the fact that set it answers first again, so a failed delivery is not lost.
    const organization = await this.prisma.nurturingOrganization.findUnique({
      where: { organizationId },
      select: { codingFirstSessionAt: true },
    });
    return { first: organization?.codingFirstSessionAt?.getTime() === occurredAt };
  }

  async addCodingAgentType({
    organizationId,
    agentType,
  }: Parameters<NurturingCodingMilestonesRepository["addCodingAgentType"]>[0]): Promise<{
    changed: boolean;
    codingAgentTypes: string[];
  }> {
    const { count } = await this.prisma.nurturingOrganization.updateMany({
      where: { organizationId, NOT: { codingAgentTypes: { has: agentType } } },
      data: { codingAgentTypes: { push: agentType } },
    });
    const organization = await this.prisma.nurturingOrganization.findUnique({
      where: { organizationId },
      select: { codingAgentTypes: true },
    });
    return { changed: count === 1, codingAgentTypes: organization?.codingAgentTypes ?? [] };
  }

  async recordCodingActiveDay({
    organizationId,
    day,
  }: Parameters<NurturingCodingMilestonesRepository["recordCodingActiveDay"]>[0]): Promise<{
    changed: boolean;
    codingActiveDays: number;
  }> {
    const { count } = await this.prisma.nurturingOrganization.updateMany({
      where: {
        organizationId,
        OR: [{ codingLastActiveDay: null }, { codingLastActiveDay: { lt: day } }],
      },
      data: { codingActiveDays: { increment: 1 }, codingLastActiveDay: day },
    });
    const organization = await this.prisma.nurturingOrganization.findUnique({
      where: { organizationId },
      select: { codingActiveDays: true, codingLastActiveDay: true },
    });
    // The day already counted answers changed again, so a failed delivery is not lost.
    return {
      changed: count === 1 || organization?.codingLastActiveDay === day,
      codingActiveDays: organization?.codingActiveDays ?? 0,
    };
  }

  /** Empty when nurturing never learned the organization. */
  private async count({
    organizationId,
    data,
  }: {
    organizationId: string;
    data:
      | { evaluationCount: { increment: number } }
      | { simulationRunCount: { increment: number } };
  }): Promise<NurturingOrganizationCounts[]> {
    const { count } = await this.prisma.nurturingOrganization.updateMany({
      where: { organizationId },
      data,
    });
    if (count === 0) return [];
    const organization = await this.prisma.nurturingOrganization.findUnique({
      where: { organizationId },
      select: ORGANIZATION_STATE,
    });
    return organization ? [organization] : [];
  }
}
