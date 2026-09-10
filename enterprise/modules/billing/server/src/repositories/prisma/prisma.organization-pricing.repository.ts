import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { OrganizationPricing } from "../organization/organization-pricing.repository.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type BillingOrganizationPricingDatabase = Pick<PrismaClient, "organization">;

export class PrismaOrganizationPricingRepository extends OrganizationPricing {
  private constructor(private readonly prisma: BillingOrganizationPricingDatabase) {
    super();
  }

  static create(database: BillingOrganizationPricingDatabase): PrismaOrganizationPricingRepository {
    return new PrismaOrganizationPricingRepository(database);
  }

  async tryGetPricingModel(organizationId: string): Promise<string | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { pricingModel: true },
    });
    return organization?.pricingModel ?? null;
  }
}
