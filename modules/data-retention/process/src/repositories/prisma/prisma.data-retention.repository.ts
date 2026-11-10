import {
  retentionPolicySchema,
  retentionRowSchema,
  type RetentionCategory,
  type RetentionPolicy,
  type RetentionRow,
  type ScopeAssignment,
} from "@langwatch/data-retention-contract";
import {
  PrismaRepository,
  skipTenantCheck,
  type PrismaRepositoryClient,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { z } from "zod";

import type { DataRetentionRepository } from "../data-retention.repository.ts";

const retentionRowSelect = {
  scopeType: true,
  scopeId: true,
  category: true,
  retentionDays: true,
} as const;

const organizationIdRowsSchema = z.array(z.object({ organizationId: z.string() }));

type DataRetentionDatabase = PrismaRepositoryClient<readonly ["RetentionPolicy"]> &
  Pick<PrismaClient, "$queryRaw">;

export class PrismaDataRetentionRepository
  extends PrismaRepository.for("RetentionPolicy")
  implements DataRetentionRepository
{
  static create({ prisma }: { prisma: DataRetentionDatabase }): PrismaDataRetentionRepository {
    return new PrismaDataRetentionRepository(prisma);
  }

  private readonly raw: Pick<PrismaClient, "$queryRaw">;

  private constructor(prisma: DataRetentionDatabase) {
    super(prisma);
    this.raw = prisma;
  }

  async findForProjectChain(input: {
    organizationId: string;
    scopes: ScopeAssignment[];
  }): Promise<RetentionRow[]> {
    const rows = await this.prisma.retentionPolicy.findMany({
      where: {
        organizationId: input.organizationId,
        OR: input.scopes,
      },
      select: retentionRowSelect,
    });

    return rows.map((row) => retentionRowSchema.parse(row));
  }

  async findAllInOrganization(input: { organizationId: string }): Promise<RetentionPolicy[]> {
    const rows = await this.prisma.retentionPolicy.findMany({
      where: { organizationId: input.organizationId },
    });

    return rows.map((row) => retentionPolicySchema.parse(row));
  }

  async findAllInOrganizations(input: {
    organizationIds: readonly string[];
  }): Promise<RetentionPolicy[]> {
    if (input.organizationIds.length === 0) return [];
    const rows = await this.prisma.retentionPolicy.findMany({
      where: { organizationId: { in: [...input.organizationIds] } },
    });

    return rows.map((row) => retentionPolicySchema.parse(row));
  }

  async findOrganizationIdsWithRules(): Promise<string[]> {
    const rows = await this.raw.$queryRaw`
      ${skipTenantCheck({
        // The daily storage report walks every organization holding a rule; it reads ids only.
        SKIP_TENANT_CHECK: true,
      })}
      SELECT DISTINCT "organizationId" FROM "RetentionPolicy" ORDER BY "organizationId" ASC
    `;

    return organizationIdRowsSchema.parse(rows).map((row) => row.organizationId);
  }

  async upsertForScope(input: {
    organizationId: string;
    scope: ScopeAssignment;
    category: RetentionCategory;
    retentionDays: number;
  }): Promise<RetentionPolicy> {
    const row = await this.prisma.retentionPolicy.upsert({
      where: {
        scopeType_scopeId_category: {
          scopeType: input.scope.scopeType,
          scopeId: input.scope.scopeId,
          category: input.category,
        },
      },
      update: {
        organizationId: input.organizationId,
        retentionDays: input.retentionDays,
      },
      create: {
        organizationId: input.organizationId,
        scopeType: input.scope.scopeType,
        scopeId: input.scope.scopeId,
        category: input.category,
        retentionDays: input.retentionDays,
      },
    });

    return retentionPolicySchema.parse(row);
  }

  async deleteForScope(input: {
    scope: ScopeAssignment;
    category: RetentionCategory;
  }): Promise<void> {
    await this.prisma.retentionPolicy.deleteMany({
      where: {
        scopeType: input.scope.scopeType,
        scopeId: input.scope.scopeId,
        category: input.category,
      },
    });
  }
}
