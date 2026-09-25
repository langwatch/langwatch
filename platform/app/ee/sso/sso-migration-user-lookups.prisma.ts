// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { PrismaClient } from "~/generated/prisma/client";

/**
 * The other organizations any of these users belong to.
 *
 * A migration has to know whether a member's legacy identity is shared with
 * another organization's grandfathered connection, which is a question about
 * memberships OUTSIDE the tenant asking it. `OrganizationUser` is tenancy
 * guarded, so a `findMany` bounded only by `organizationId: { not }` is refused
 * at the client; the same rows read through the users they belong to, where
 * the relation carries the bound and the guard has nothing to refuse.
 */
export async function findOtherOrganizationIds({
  prisma,
  organizationId,
  userIds,
}: {
  prisma: Pick<PrismaClient, "user">;
  organizationId: string;
  userIds: string[];
}): Promise<string[]> {
  if (userIds.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      orgMemberships: {
        where: { organizationId: { not: organizationId } },
        select: { organizationId: true },
      },
    },
  });
  return [
    ...new Set(
      users.flatMap(({ orgMemberships }) =>
        orgMemberships.map((row) => row.organizationId),
      ),
    ),
  ];
}

/**
 * How many accounts hold each address, compared without case and keyed by the
 * lowercased address. The one count both a real arrival and the progress page
 * use, so the page never promises a match the arrival refuses.
 */
export async function countAccountsHoldingAddresses({
  prisma,
  addresses,
}: {
  prisma: Pick<PrismaClient, "$queryRaw">;
  addresses: string[];
}): Promise<Map<string, number>> {
  const lowered = [
    ...new Set(addresses.map((address) => address.toLowerCase())),
  ];
  if (lowered.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ address: string; holders: bigint }[]>`
    -- @tenancy: an address names one account fleet-wide or it names nobody; only a migrating organization's members' addresses are counted
    SELECT lower("email") AS "address", count(*) AS "holders"
    FROM "User"
    WHERE lower("email") = ANY(${lowered}::text[])
    GROUP BY 1
  `;
  return new Map(rows.map((row) => [row.address, Number(row.holders)]));
}
