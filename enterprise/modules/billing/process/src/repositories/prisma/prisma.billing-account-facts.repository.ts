import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { BillingAccountFactsRepository } from "../billing-account-facts.repository.ts";

/** Prisma implementation of the narrow organization reads Billing needs. */
/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
type BillingOrganizationDatabase = Pick<PrismaClient, "organization" | "team" | "$executeRaw">;

export class PrismaBillingOrganizationRepository extends BillingAccountFactsRepository {
  private constructor(private readonly prisma: BillingOrganizationDatabase) {
    super();
  }

  static create(prisma: BillingOrganizationDatabase): PrismaBillingOrganizationRepository {
    return new PrismaBillingOrganizationRepository(prisma);
  }

  async findPricingModel(organizationId: string): Promise<string | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { pricingModel: true },
    });
    return organization?.pricingModel ?? null;
  }

  async findStripeCustomerId(organizationId: string): Promise<string | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { stripeCustomerId: true },
    });
    return organization?.stripeCustomerId ?? null;
  }

  async findName(organizationId: string): Promise<{ id: string; name: string } | null> {
    return this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
  }

  async findFirstTeamId(organizationId: string): Promise<string | null> {
    const team = await this.prisma.team.findFirst({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    return team?.id ?? null;
  }

  async findBillingProfile(
    organizationId: string,
  ): Promise<{ name: string; stripeCustomerId: string | null } | null> {
    return this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, stripeCustomerId: true },
    });
  }

  async claimStripeCustomerId(input: {
    organizationId: string;
    stripeCustomerId: string;
  }): Promise<boolean> {
    // The condition sits on the table: a write parked on the row lock re-checks it against
    // the committed row, so only one of two checkouts started together is told it won.
    const updated = await this.prisma.$executeRaw`
      -- @tenancy: an organization is addressed by its own primary key.
      UPDATE "Organization"
         SET "stripeCustomerId" = ${input.stripeCustomerId},
             "updatedAt" = now()
       WHERE "id" = ${input.organizationId}
         AND "stripeCustomerId" IS NULL
    `;
    return updated > 0;
  }
}
