/**
 * The two Cloud lookups the self-hosted lead signals need (ADR-139, section
 * 10): who to write a customer's Customer.io traits through, and whether a
 * company already has an account with us.
 */

import type { PrismaClient } from "~/generated/prisma/client";
import type { CloudCustomer, CloudCustomerLookup } from "./selfHostedCrm";

export class PrismaCloudCustomers implements CloudCustomerLookup {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * The organization's longest-standing member.
   *
   * Customer.io writes object traits through a person, so it has to be one of
   * them; the oldest membership is chosen because it is the same one on every
   * report, and traits written through two different people on two days read as
   * two different sources.
   */
  async findRepresentative(
    organizationId: string,
  ): Promise<CloudCustomer | null> {
    const [organization, membership] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      }),
      this.prisma.organizationUser.findFirst({
        where: { organizationId },
        orderBy: { createdAt: "asc" },
        select: { userId: true },
      }),
    ]);
    if (!organization || !membership) return null;
    return { userId: membership.userId, organizationName: organization.name };
  }

  /**
   * Whether anybody with an address on this domain has a Cloud account.
   *
   * A raw query because the join is on the part of the address after the `@`,
   * which no column holds. It reads one row at most and returns a boolean: no
   * address reaches the application process, exactly as in the report's own
   * domain aggregation.
   */
  async hasAccountOnDomain(domain: string): Promise<boolean> {
    const normalised = domain.trim().toLowerCase();
    if (!normalised || normalised.includes("%")) return false;

    const rows = await this.prisma.$queryRaw<{ found: number }[]>`
      -- @tenancy: asks whether any customer at all is on this domain, which is
      -- the question; scoping it to one tenant would always answer no.
      SELECT 1 AS found
        FROM "User"
       WHERE split_part(lower(trim("email")), '@', 2) = ${normalised}
       LIMIT 1
    `;
    return rows.length > 0;
  }
}
