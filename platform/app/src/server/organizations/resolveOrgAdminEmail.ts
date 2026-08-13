import type { PrismaClient } from "@prisma/client";

/**
 * Resolves the first ADMIN member's email for an org. Strictly an email
 * — used as the recipient when we need to actually SEND email (eg.
 * budget-increase requests). Distinct from [[resolveSupportContact]]
 * which may return a URL or free text intended for user display.
 *
 * Membership rows and users are read separately on purpose. The `user`
 * relation is backed by no database foreign key (the schema runs
 * `relationMode = "prisma"`), so an `OrganizationUser` can outlive the
 * `User` it points at. Asking Prisma to join a required relation makes a
 * single dangling row reject the whole read with "Inconsistent query
 * result: Field user is required to return data, got null instead".
 * Orphaned memberships are skipped instead, and the first admin that
 * still resolves to a user with an email wins.
 *
 * Returns null when the org has no admin membership, or when every admin
 * membership is orphaned.
 */
export async function resolveOrgAdminEmail({
  prisma,
  organizationId,
}: {
  prisma: PrismaClient;
  organizationId: string;
}): Promise<string | null> {
  const admins = await prisma.organizationUser.findMany({
    where: { organizationId, role: "ADMIN" },
    select: { userId: true },
    orderBy: { createdAt: "asc" },
  });
  if (admins.length === 0) return null;

  const users = await prisma.user.findMany({
    where: { id: { in: admins.map((admin) => admin.userId) } },
    select: { id: true, email: true },
  });
  const emailByUserId = new Map(users.map((user) => [user.id, user.email]));

  for (const admin of admins) {
    const email = emailByUserId.get(admin.userId);
    if (email) return email;
  }
  return null;
}
