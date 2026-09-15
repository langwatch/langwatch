import {
  dataPrivacyPolicySchema,
  dataPrivacyRowSchema,
  type DataPrivacyConfig,
  type DataPrivacyPolicy,
  type DataPrivacyRow,
  type DataPrivacyScope,
} from "@langwatch/data-privacy-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import { Prisma } from "@langwatch/prisma-client/generated";
import type { DataPrivacyPolicyRepository } from "../data-privacy.repository.ts";

export class PrismaDataPrivacyPolicyRepository
  extends PrismaRepository.for("DataPrivacyPolicy")
  implements DataPrivacyPolicyRepository
{
  static readonly create = this.factory((prisma) => new PrismaDataPrivacyPolicyRepository(prisma));

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
    const rows = await this.prisma.dataPrivacyPolicy.findMany({
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
    const rows = await this.prisma.dataPrivacyPolicy.findMany({
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
    const row = await this.prisma.dataPrivacyPolicy.upsert({
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
    await this.prisma.dataPrivacyPolicy.deleteMany({
      where: {
        organizationId: input.organizationId,
        scopeType: input.scope.scopeType,
        scopeId: input.scope.scopeId,
        personalOnly: input.personalOnly,
      },
    });
  }
}
