import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { OrganizationPricingRepository } from "../../ports/organization-pricing.port";

export class PrismaOrganizationPricingRepository extends OrganizationPricingRepository {
  private constructor(private readonly prisma: PrismaClient) { super(); }

  static create(database: object): PrismaOrganizationPricingRepository {
    return new PrismaOrganizationPricingRepository(database as PrismaClient);
  }

  async getPricingModel(organizationId: string): Promise<string | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { pricingModel: true },
    });
    return organization?.pricingModel ?? null;
  }
}
