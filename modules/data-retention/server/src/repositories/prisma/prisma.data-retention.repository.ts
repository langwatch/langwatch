import {
  retentionPolicySchema,
  retentionRowSchema,
  type RetentionCategory,
  type RetentionPolicy,
  type RetentionRow,
  type ScopeAssignment,
} from "@langwatch/data-retention-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { DataRetentionRepository } from "../data-retention.repository.ts";

const retentionRowSelect = {
  scopeType: true,
  scopeId: true,
  category: true,
  retentionDays: true,
} as const;

export class PrismaDataRetentionRepository
  extends PrismaRepository.for("RetentionPolicy")
  implements DataRetentionRepository
{
  static readonly create = this.factory((prisma) => new PrismaDataRetentionRepository(prisma));

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
