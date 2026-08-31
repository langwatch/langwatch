import {
  dataPrivacyPolicySchema,
  dataPrivacyRowSchema,
  type DataPrivacyPolicy,
  type DataPrivacyRow,
  type DataPrivacyScope,
  type DataPrivacyConfig,
} from "@langwatch/data-privacy-contract";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { DataPrivacyPolicyRepository } from "../../ports/data-privacy.repository";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type DataPrivacyDatabase = Pick<PrismaClient, "dataPrivacyPolicy">;

export class PrismaDataPrivacyPolicyRepository extends DataPrivacyPolicyRepository {
  private constructor(private readonly database: DataPrivacyDatabase) {
    super();
  }

  static create(database: DataPrivacyDatabase): PrismaDataPrivacyPolicyRepository {
    return new PrismaDataPrivacyPolicyRepository(database);
  }

  async findForProjectChain(input: {
    organizationId: string;
    scopes: Array<Pick<DataPrivacyRow, "scopeType" | "scopeId" | "personalOnly">>;
  }): Promise<DataPrivacyRow[]> {
    const pairs = [
      ...new Map(
        input.scopes.map((candidate) => [
          `${candidate.scopeType}:${candidate.scopeId}`,
          { scopeType: candidate.scopeType, scopeId: candidate.scopeId },
        ]),
      ).values(),
    ];
    const rows = await this.database.dataPrivacyPolicy.findMany({
      where: {
        organizationId: input.organizationId,
        OR: pairs,
      },
    });
    return rows.map((row) =>
      dataPrivacyRowSchema.parse({
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        personalOnly: row.personalOnly,
        config: row.config,
      }),
    );
  }

  async findAllInOrganization(input: { organizationId: string }): Promise<DataPrivacyPolicy[]> {
    const rows = await this.database.dataPrivacyPolicy.findMany({
      where: { organizationId: input.organizationId },
    });
    return rows.map((row) => dataPrivacyPolicySchema.parse(row));
  }

  async upsertForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
    config: DataPrivacyConfig;
  }): Promise<DataPrivacyPolicy> {
    const configJson = input.config as Prisma.InputJsonValue;
    const row = await this.database.dataPrivacyPolicy.upsert({
      where: {
        scopeType_scopeId_personalOnly: {
          scopeType: input.scope.scopeType,
          scopeId: input.scope.scopeId,
          personalOnly: input.personalOnly,
        },
      },
      update: { config: configJson, organizationId: input.organizationId },
      create: {
        organizationId: input.organizationId,
        scopeType: input.scope.scopeType,
        scopeId: input.scope.scopeId,
        personalOnly: input.personalOnly,
        config: configJson,
      },
    });
    return dataPrivacyPolicySchema.parse(row);
  }

  async deleteForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
  }): Promise<void> {
    await this.database.dataPrivacyPolicy.deleteMany({
      where: {
        organizationId: input.organizationId,
        scopeType: input.scope.scopeType,
        scopeId: input.scope.scopeId,
        personalOnly: input.personalOnly,
      },
    });
  }

  async tryFindById(input: { id: string }): Promise<DataPrivacyPolicy | null> {
    const row = await this.database.dataPrivacyPolicy.findUnique({
      where: { id: input.id },
    });
    return row ? dataPrivacyPolicySchema.parse(row) : null;
  }
}
