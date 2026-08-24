import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  BillingOrganizationRepository,
  type BillingOrganization,
} from "../../ports/billing-organization.port";

export class PrismaBillingOrganizationRepository extends BillingOrganizationRepository {
  private constructor(private readonly prisma: PrismaClient) { super(); }

  static create(database: object): PrismaBillingOrganizationRepository {
    return new PrismaBillingOrganizationRepository(database as PrismaClient);
  }

  findById(organizationId: string): Promise<BillingOrganization | null> {
    return this.prisma.organization.findUnique({ where: { id: organizationId } });
  }

  async claimStripeCustomerId(input: { organizationId: string; stripeCustomerId: string }): Promise<boolean> {
    const result = await this.prisma.organization.updateMany({
      where: { id: input.organizationId, stripeCustomerId: null },
      data: { stripeCustomerId: input.stripeCustomerId },
    });
    return result.count > 0;
  }

  requireById(organizationId: string): Promise<BillingOrganization> {
    return this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  }
}
