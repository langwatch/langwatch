import type {
  OrganizationIdPage,
  OrganizationIdPageInput,
  OrganizationWithAdministrators,
} from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate } from "@langwatch/time";

import { BillingAccountFactsRepository } from "../billing-account-facts.repository.ts";

/** Prisma implementation of the narrow organization reads Billing needs. */
/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
type BillingOrganizationDatabase = Pick<
  PrismaClient,
  "organization" | "organizationUser" | "user" | "team" | "$executeRaw"
>;

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

  async findWithAdministrators(
    organizationId: string,
  ): Promise<OrganizationWithAdministrators | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, sentPlanLimitAlert: true },
    });
    if (!organization) return null;
    const admins = await this.prisma.organizationUser.findMany({
      where: { organizationId, role: "ADMIN" },
      select: { userId: true },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: admins.map((admin) => admin.userId) } },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(users.map((user) => [user.id, user]));
    return {
      id: organization.id,
      name: organization.name,
      sentPlanLimitAlert:
        organization.sentPlanLimitAlert && fromDate(organization.sentPlanLimitAlert),
      administrators: admins.flatMap(({ userId }) => {
        const user = byId.get(userId);
        return user ? [{ userId, name: user.name, email: user.email }] : [];
      }),
    };
  }

  async findActiveMemberIds(organizationId: string): Promise<string[]> {
    const members = await this.prisma.organizationUser.findMany({
      where: { organizationId, disabledAt: null, user: { deactivatedAt: null } },
      select: { userId: true },
    });
    return members.map((member) => member.userId);
  }

  async findSelfHostedCustomers(): Promise<{ organizationId: string; organizationName: string }[]> {
    const rows = await this.prisma.organization.findMany({
      where: { selfHostedCustomer: true },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({ organizationId: row.id, organizationName: row.name }));
  }

  async listIds({ after, limit }: OrganizationIdPageInput = {}): Promise<OrganizationIdPage> {
    const rows = await this.prisma.organization.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
      ...(after === undefined ? {} : { where: { id: { gt: after } } }),
      ...(limit === undefined ? {} : { take: limit + 1 }),
    });
    const ids = rows.map((row) => row.id);
    if (limit === undefined || ids.length <= limit) return { ids, next: null };
    const page = ids.slice(0, limit);
    return { ids: page, next: page.at(-1) ?? null };
  }
}
