import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { OrganizationPricingRepository } from "../../ports/organization-pricing.port";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type BillingOrganizationPricingDatabase = Pick<PrismaClient, "organization">;

export class PrismaOrganizationPricingRepository extends OrganizationPricingRepository {
  private constructor(private readonly prisma: BillingOrganizationPricingDatabase) {
    super();
  }

  static create(database: object): PrismaOrganizationPricingRepository {
    return new PrismaOrganizationPricingRepository(database as PrismaClient);
  }

  async tryGetPricingModel(organizationId: string): Promise<string | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { pricingModel: true },
    });
    return organization?.pricingModel ?? null;
  }
}
