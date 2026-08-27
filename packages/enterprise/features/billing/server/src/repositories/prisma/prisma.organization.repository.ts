import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { BillingOrganizationRepository } from "../../ports/organization.port";

/** Prisma implementation of the narrow organization reads Billing needs. */
export class PrismaBillingOrganizationRepository extends BillingOrganizationRepository {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(prisma: PrismaClient): PrismaBillingOrganizationRepository {
    return new PrismaBillingOrganizationRepository(prisma);
  }

  async tryGetPricingModel(organizationId: string): Promise<string | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { pricingModel: true },
    });
    return organization?.pricingModel ?? null;
  }

  async tryGetStripeCustomerId(organizationId: string): Promise<string | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { stripeCustomerId: true },
    });
    return organization?.stripeCustomerId ?? null;
  }

  async tryFindName(
    organizationId: string,
  ): Promise<{ id: string; name: string } | null> {
    return this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
  }

  async tryFindFirstTeamId(organizationId: string): Promise<string | null> {
    const team = await this.prisma.team.findFirst({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    return team?.id ?? null;
  }
}
