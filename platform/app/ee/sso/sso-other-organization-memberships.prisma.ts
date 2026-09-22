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
