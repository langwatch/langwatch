import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  retentionPolicySchema,
  retentionRowSchema,
  retentionCategorySchema,
  retentionScopeSchema,
  type RetentionCategory,
  type RetentionPolicy,
  type RetentionRow,
  type ScopeAssignment,
} from "@langwatch/data-retention-contract";
import { DataRetentionRepository } from "../data-retention.repository";

export class PrismaDataRetentionRepository extends DataRetentionRepository {
  static create(options: { prisma: PrismaClient }): PrismaDataRetentionRepository {
    return new PrismaDataRetentionRepository(options.prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async findForScopes(input: {
    organizationId: string;
    scopes: ScopeAssignment[];
  }): Promise<RetentionRow[]> {
    const rows = await this.prisma.retentionPolicy.findMany({
      where: {
        organizationId: input.organizationId,
        OR: input.scopes,
      },
      select: { scopeType: true, scopeId: true, category: true, retentionDays: true },
    });
    return rows.map((row) =>
      retentionRowSchema.parse({
        scopeType: retentionScopeSchema.parse(row.scopeType),
        scopeId: row.scopeId,
        category: retentionCategorySchema.parse(row.category),
        retentionDays: row.retentionDays,
      }),
    );
  }

  async findAllInOrganization(input: {
    organizationId: string;
  }): Promise<RetentionPolicy[]> {
    const rows = await this.prisma.retentionPolicy.findMany({
      where: { organizationId: input.organizationId },
    });
    return rows.map((row) =>
      retentionPolicySchema.parse({ ...row, category: row.category }),
    );
  }

  async tryFindById(input: { id: string }): Promise<RetentionPolicy | null> {
    const row = await this.prisma.retentionPolicy.findUnique({ where: { id: input.id } });
    return row ? retentionPolicySchema.parse({ ...row, category: row.category }) : null;
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
