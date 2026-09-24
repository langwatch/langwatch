// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { toDate, type Instant } from "@langwatch/time";

import {
  GovernanceTenantHistoryRepository,
  type GovernanceTenantRow,
} from "../governance-tenant-history.repository.ts";

export type GovernanceTenantHistoryDatabase = Pick<PrismaClient, "governanceTenantHistory">;

export class PrismaGovernanceTenantHistoryRepository extends GovernanceTenantHistoryRepository {
  private constructor(private readonly prisma: GovernanceTenantHistoryDatabase) {
    super();
  }

  static create(
    database: GovernanceTenantHistoryDatabase,
  ): PrismaGovernanceTenantHistoryRepository {
    return new PrismaGovernanceTenantHistoryRepository(database);
  }

  findAllByOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<GovernanceTenantRow[]> {
    return this.prisma.governanceTenantHistory.findMany({
      where: { organizationId },
      select: { organizationId: true, tenantId: true },
      orderBy: { firstUsedAt: "asc" },
    });
  }

  findAll(): Promise<GovernanceTenantRow[]> {
    return this.prisma.governanceTenantHistory.findMany({
      select: { organizationId: true, tenantId: true },
    });
  }

  async touch({
    organizationId,
    tenantId,
    at,
  }: {
    organizationId: string;
    tenantId: string;
    at: Instant;
  }): Promise<boolean> {
    const result = await this.prisma.governanceTenantHistory.updateMany({
      where: { organizationId, tenantId },
      data: { lastUsedAt: toDate(at) },
    });
    return result.count > 0;
  }

  async append({
    organizationId,
    tenantId,
    at,
  }: {
    organizationId: string;
    tenantId: string;
    at: Instant;
  }): Promise<void> {
    // skipDuplicates, not a caught P2002: two workers resolving one project at once is normal.
    await this.prisma.governanceTenantHistory.createMany({
      data: [{ organizationId, tenantId, firstUsedAt: toDate(at), lastUsedAt: toDate(at) }],
      skipDuplicates: true,
    });
  }
}
