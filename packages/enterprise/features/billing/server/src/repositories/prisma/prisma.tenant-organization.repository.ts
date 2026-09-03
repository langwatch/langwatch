// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { BillingTenantOrganizationPort } from "../../ports/tenant-organization.port";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type BillingTenantOrganizationDatabase = Pick<PrismaClient, "project">;

/** Prisma implementation of the tenant-to-organization attribution lookup. */
export class PrismaBillingTenantOrganizationRepository extends BillingTenantOrganizationPort {
  private constructor(private readonly prisma: BillingTenantOrganizationDatabase) {
    super();
  }

  static create(
    prisma: BillingTenantOrganizationDatabase,
  ): PrismaBillingTenantOrganizationRepository {
    return new PrismaBillingTenantOrganizationRepository(prisma);
  }

  async tryFindOrganizationForTenant(tenantId: string): Promise<string | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: tenantId },
      select: { team: { select: { organizationId: true } } },
    });
    return project?.team?.organizationId ?? null;
  }
}
