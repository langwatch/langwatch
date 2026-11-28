// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository, skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { NurturingErasedUserRepository } from "../nurturing-erased-user.repository.ts";
import {
  MAX_CODING_REPOSITORY_KEYS,
  type NurturingCodingMilestonesRepository,
  type NurturingMilestonesRepository,
  type NurturingOrganizationAdminRepository,
  type NurturingOrganizationCounts,
  type NurturingOrganizationRow,
  type NurturingTraceMilestonesRepository,
} from "../nurturing-milestones.repository.ts";
import {
  type NurturingErasedUserDatabase,
  PrismaNurturingErasedUserRepository,
} from "./prisma.nurturing-erased-user.repository.ts";

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

type NurturingOrganizationDatabase = Pick<PrismaClient, "nurturingOrganization" | "$executeRaw"> &
  NurturingErasedUserDatabase;

type ErasedUsers = Pick<NurturingErasedUserRepository, "markErased" | "findErased">;

/**
 * Nurturing's organizations, read with no erased admin through the erasure marks; the owners'
 * rows are read elsewhere (R40).
 */
export class PrismaNurturingMilestonesRepository
  extends PrismaRepository.for("NurturingOrganization")
  implements
    NurturingMilestonesRepository,
    NurturingCodingMilestonesRepository,
    NurturingTraceMilestonesRepository,
    NurturingOrganizationAdminRepository
{
  /** `erasedUsers` defaults to the marks over the same client. */
  static create({
    prisma,
    erasedUsers = PrismaNurturingErasedUserRepository.create({ prisma }),
  }: Readonly<{
    prisma: NurturingOrganizationDatabase;
    erasedUsers?: ErasedUsers;
  }>): PrismaNurturingMilestonesRepository {
    return new PrismaNurturingMilestonesRepository(prisma, erasedUsers);
  }

  readonly #database: NurturingOrganizationDatabase;
  readonly #erasedUsers: ErasedUsers;

  private constructor(prisma: NurturingOrganizationDatabase, erasedUsers: ErasedUsers) {
    super(prisma);
    this.#database = prisma;
    this.#erasedUsers = erasedUsers;
  }

  async recordLastTrace({
    organizationId,
    occurredAt,
  }: Readonly<{ organizationId: string; occurredAt: number }>): Promise<void> {
    const at = new Date(occurredAt);
    // One upsert in SQL, for the reason given above `recordCodingFirstSession`: GREATEST moves the
    // time forward only, so any order or repeat of a fact leaves the same row. The fact's own
    // organization is compared with its bound id: the tenancy guard reads no tenant from an
    // INSERT ... SELECT's column list, only from a comparison.
    await this.#database.$executeRaw`
      INSERT INTO "NurturingOrganization" ("organizationId", "lastTraceAt", "updatedAt")
      SELECT fact."organizationId", fact."lastTraceAt", now()
        FROM (VALUES (${organizationId}, (${at}::timestamptz AT TIME ZONE 'UTC')::timestamp(3)))
             AS fact ("organizationId", "lastTraceAt")
       WHERE fact."organizationId" = ${organizationId}
      ON CONFLICT ("organizationId") DO UPDATE
         SET "lastTraceAt" = GREATEST("NurturingOrganization"."lastTraceAt", EXCLUDED."lastTraceAt"),
             "updatedAt" = now()
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

  /**
   * One upsert, order-free as the key copy's holder is: a later stamp replaces the admin, one stamp
   * keeps the greater id (byte order, as the memory twin compares), and GREATEST keeps the latest
   * stamp. A marked admin is written NULL at the fact's stamp, so it clears an admin stamped
   * earlier. The upsert writes nothing when it would change nothing, so a redelivered or replayed
   * fact leaves the row, `updatedAt` included, as it was. The re-check after it clears an admin
   * whose erasure raced the upsert; the upsert's own mark check only shortens how long such a
   * row is visible.
   */
  async recordAdminFact({
    organizationId,
    adminUserId,
    at,
    seeded,
  }: Parameters<NurturingOrganizationAdminRepository["recordAdminFact"]>[0]): Promise<void> {
    const adminAt = adminUserId === null ? null : new Date(at);
    const marked = PrismaNurturingErasedUserRepository.markExists(adminUserId);
    await this.#database.$executeRaw`
      INSERT INTO "NurturingOrganization" AS known
        ("organizationId", "adminUserId", "adminAt", "seeded", "updatedAt")
      VALUES (${organizationId}, CASE WHEN ${marked} THEN NULL ELSE ${adminUserId} END,
              (${adminAt}::timestamptz AT TIME ZONE 'UTC')::timestamp(3), ${seeded}, now())
      ON CONFLICT ("organizationId") DO UPDATE SET
        "adminUserId" = CASE
            WHEN EXCLUDED."adminAt" > COALESCE(known."adminAt", '-infinity'::timestamp)
              THEN EXCLUDED."adminUserId"
            WHEN EXCLUDED."adminAt" = known."adminAt"
              THEN GREATEST(known."adminUserId" COLLATE "C", EXCLUDED."adminUserId" COLLATE "C")
            ELSE known."adminUserId" END,
        "adminAt" = GREATEST(known."adminAt", EXCLUDED."adminAt"),
        "seeded" = known."seeded" OR EXCLUDED."seeded",
        "updatedAt" = now()
      WHERE EXCLUDED."adminAt" > COALESCE(known."adminAt", '-infinity'::timestamp)
         OR (EXCLUDED."adminAt" = known."adminAt"
             AND known."adminUserId" COLLATE "C" IS DISTINCT FROM
                 GREATEST(known."adminUserId" COLLATE "C", EXCLUDED."adminUserId" COLLATE "C"))
         OR (EXCLUDED."seeded" AND NOT known."seeded")
    `;
    if (adminUserId === null) return;
    // The upsert can read no mark for an admin whose erasure has not committed it yet, then land
    // after the erasure's clearing UPDATE passed. This separate statement closes that race: if it
    // starts after the mark commits, it sees the mark; if before, the upsert committed before the
    // mark, so the erasure's UPDATE, which starts after its mark, sees the row. The cleared admin
    // keeps its stamp, as `forgetAdmin` clears one, so no older fact refills it.
    await this.#database.$executeRaw`
      UPDATE "NurturingOrganization"
         SET "adminUserId" = NULL, "updatedAt" = now()
       WHERE "organizationId" = ${organizationId} AND "adminUserId" = ${adminUserId} AND ${marked}`;
  }

  /**
   * Marks the account erased first, so no read names them admin from then on, even where a late
   * fact stores them again; then clears the rows naming them. Each keeps its admin's stamp, so no
   * older fact refills it.
   */
  async forgetAdmin({ adminUserId }: Readonly<{ adminUserId: string }>): Promise<void> {
    await this.#erasedUsers.markErased({ userId: adminUserId });
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
        adminUserId: await this.#unlessErased(organization.adminUserId),
        codingFirstSessionAt: organization.codingFirstSessionAt?.getTime() ?? null,
      },
    ];
  }

  /** A marked admin reads as none: a late fact can store them again after their erasure. */
  async #unlessErased(adminUserId: string | null): Promise<string | null> {
    if (adminUserId === null) return null;
    const [erased] = await this.#erasedUsers.findErased({ userIds: [adminUserId] });
    return erased ? null : adminUserId;
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

  /** Empty when nurturing never learned the organization; a marked admin reads as none. */
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
    if (!organization) return [];
    return [{ ...organization, adminUserId: await this.#unlessErased(organization.adminUserId) }];
  }
}
