import {
  retentionPolicySchema,
  retentionRowSchema,
  type RetentionCategory,
  type RetentionPolicy,
  type RetentionRow,
  type ScopeAssignment,
} from "@langwatch/data-retention-contract";
import { DataRetentionRepository } from "../data-retention.repository";
import type { DataRetentionDatabasePort } from "../../ports/data-retention-database.port";

export class PrismaDataRetentionRepository extends DataRetentionRepository {
  static create(options: { database: DataRetentionDatabasePort }): PrismaDataRetentionRepository {
    return new PrismaDataRetentionRepository(options.database);
  }

  private constructor(private readonly database: DataRetentionDatabasePort) {
    super();
  }

  async findForProjectChain(input: {
    organizationId: string;
    scopes: ScopeAssignment[];
  }): Promise<RetentionRow[]> {
    const rows = await this.database.retentionPolicy.findMany({
      where: {
        organizationId: input.organizationId,
        OR: input.scopes,
      },
      select: { scopeType: true, scopeId: true, category: true, retentionDays: true },
    });
    return rows.map((row) => retentionRowSchema.parse(row));
  }

  async findAllInOrganization(input: { organizationId: string }): Promise<RetentionPolicy[]> {
    const rows = await this.database.retentionPolicy.findMany({
      where: { organizationId: input.organizationId },
    });
    return rows.map((row) => retentionPolicySchema.parse(row));
  }

  async tryFindById(input: { id: string }): Promise<RetentionPolicy | null> {
    const row = await this.database.retentionPolicy.findUnique({
      where: { id: input.id },
    });
    return row ? retentionPolicySchema.parse(row) : null;
  }

  async upsertForScope(input: {
    organizationId: string;
    scope: ScopeAssignment;
    category: RetentionCategory;
    retentionDays: number;
  }): Promise<RetentionPolicy> {
    const row = await this.database.retentionPolicy.upsert({
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
    await this.database.retentionPolicy.deleteMany({
      where: {
        scopeType: input.scope.scopeType,
        scopeId: input.scope.scopeId,
        category: input.category,
      },
    });
  }
}
