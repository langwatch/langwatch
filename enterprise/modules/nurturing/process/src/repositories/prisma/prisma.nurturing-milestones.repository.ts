// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository, skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  MAX_CODING_REPOSITORY_KEYS,
  type NurturingCodingMilestonesRepository,
  type NurturingMilestonesRepository,
  type NurturingOrganizationAdminRepository,
  type NurturingOrganizationCounts,
  type NurturingOrganizationRow,
  type NurturingTraceMilestonesRepository,
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

type NurturingOrganizationDatabase = Pick<PrismaClient, "nurturingOrganization" | "$executeRaw">;

/** Nurturing's organizations, the one table it claims; the owners' rows are read elsewhere (R40). */
export class PrismaNurturingMilestonesRepository
  extends PrismaRepository.for("NurturingOrganization")
  implements
    NurturingMilestonesRepository,
    NurturingCodingMilestonesRepository,
    NurturingTraceMilestonesRepository,
    NurturingOrganizationAdminRepository
{
  static create({
    prisma,
  }: Readonly<{ prisma: NurturingOrganizationDatabase }>): PrismaNurturingMilestonesRepository {
    return new PrismaNurturingMilestonesRepository(prisma);
  }

  readonly #database: NurturingOrganizationDatabase;

  private constructor(prisma: NurturingOrganizationDatabase) {
    super(prisma);
    this.#database = prisma;
  }

  async recordLastTrace({
    organizationId,
    occurredAt,
  }: Readonly<{ organizationId: string; occurredAt: number }>): Promise<void> {
    const at = new Date(occurredAt);
    // SQL for the reason given above `recordCodingFirstSession`: the time only moves forward.
    await this.#database.$executeRaw`
      UPDATE "NurturingOrganization"
         SET "lastTraceAt" = ${at}, "updatedAt" = now()
       WHERE "organizationId" = ${organizationId}
         AND ("lastTraceAt" IS NULL OR "lastTraceAt" < ${at})
    `;
  }

  async findLastTraceAt({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<number | null> {
    const organization = await this.prisma.nurturingOrganization.findUnique({
      where: { organizationId },
      select: { lastTraceAt: true },
    });
    return organization?.lastTraceAt?.getTime() ?? null;
  }

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

  async forgetAdmin({ adminUserId }: Readonly<{ adminUserId: string }>): Promise<void> {
    await this.#database.$executeRaw`${skipTenantCheck({
      // An erased account is admin of no organization: every row naming it is cleared by user.
      SKIP_TENANT_CHECK: true,
    })}
      UPDATE "NurturingOrganization"
         SET "adminUserId" = NULL, "updatedAt" = now()
       WHERE "adminUserId" = ${adminUserId}`;
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

  // Each coding write is one conditional UPDATE in SQL: Postgres re-checks its WHERE on the
  // locked row, so concurrent writers change the row once. Not `updateMany`, which re-checks
  // only its subquery on the statement's older snapshot and lets every writer through.
  async recordCodingFirstSession({
    organizationId,
    occurredAt,
  }: Parameters<NurturingCodingMilestonesRepository["recordCodingFirstSession"]>[0]): Promise<{
    first: boolean;
  }> {
    const count = await this.#database.$executeRaw`
      UPDATE "NurturingOrganization"
         SET "codingFirstSessionAt" = ${new Date(occurredAt)}, "updatedAt" = now()
       WHERE "organizationId" = ${organizationId}
         AND "codingFirstSessionAt" IS NULL
    `;
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
  }: Parameters<NurturingCodingMilestonesRepository["addCodingAgentType"]>[0]): Promise<string[]> {
    await this.#database.$executeRaw`
      UPDATE "NurturingOrganization"
         SET "codingAgentTypes" = array_append("codingAgentTypes", ${agentType}::text),
             "updatedAt" = now()
       WHERE "organizationId" = ${organizationId}
         AND NOT (${agentType}::text = ANY("codingAgentTypes"))
    `;
    const organization = await this.prisma.nurturingOrganization.findUnique({
      where: { organizationId },
      select: { codingAgentTypes: true },
    });
    return organization?.codingAgentTypes ?? [];
  }

  async addCodingTerminalType({
    organizationId,
    terminalType,
  }: Parameters<NurturingCodingMilestonesRepository["addCodingTerminalType"]>[0]): Promise<
    string[]
  > {
    await this.#database.$executeRaw`
      UPDATE "NurturingOrganization"
         SET "codingTerminalTypes" = array_append("codingTerminalTypes", ${terminalType}::text),
             "updatedAt" = now()
       WHERE "organizationId" = ${organizationId}
         AND NOT (${terminalType}::text = ANY("codingTerminalTypes"))
    `;
    const organization = await this.prisma.nurturingOrganization.findUnique({
      where: { organizationId },
      select: { codingTerminalTypes: true },
    });
    return organization?.codingTerminalTypes ?? [];
  }

  async addCodingRepository({
    organizationId,
    repositoryKey,
  }: Parameters<NurturingCodingMilestonesRepository["addCodingRepository"]>[0]): Promise<number> {
    await this.#database.$executeRaw`
      UPDATE "NurturingOrganization"
         SET "codingRepositoryKeys" = array_append("codingRepositoryKeys", ${repositoryKey}::text),
             "updatedAt" = now()
       WHERE "organizationId" = ${organizationId}
         AND NOT (${repositoryKey}::text = ANY("codingRepositoryKeys"))
         AND cardinality("codingRepositoryKeys") < ${MAX_CODING_REPOSITORY_KEYS}::int
    `;
    const organization = await this.prisma.nurturingOrganization.findUnique({
      where: { organizationId },
      select: { codingRepositoryKeys: true },
    });
    return organization?.codingRepositoryKeys.length ?? 0;
  }

  async addCodingSessionDayOffset({
    organizationId,
    dayOffset,
  }: Parameters<
    NurturingCodingMilestonesRepository["addCodingSessionDayOffset"]
  >[0]): Promise<number> {
    await this.#database.$executeRaw`
      UPDATE "NurturingOrganization"
         SET "codingFirstDays" = array_append("codingFirstDays", ${dayOffset}::int),
             "updatedAt" = now()
       WHERE "organizationId" = ${organizationId}
         AND NOT (${dayOffset}::int = ANY("codingFirstDays"))
    `;
    const organization = await this.prisma.nurturingOrganization.findUnique({
      where: { organizationId },
      select: { codingFirstDays: true },
    });
    return organization?.codingFirstDays.length ?? 0;
  }

  async recordCodingActiveDay({
    organizationId,
    day,
  }: Parameters<NurturingCodingMilestonesRepository["recordCodingActiveDay"]>[0]): Promise<{
    changed: boolean;
    codingActiveDays: number;
  }> {
    const count = await this.#database.$executeRaw`
      UPDATE "NurturingOrganization"
         SET "codingActiveDays" = "codingActiveDays" + 1,
             "codingLastActiveDay" = ${day},
             "updatedAt" = now()
       WHERE "organizationId" = ${organizationId}
         AND ("codingLastActiveDay" IS NULL OR "codingLastActiveDay" < ${day})
    `;
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
