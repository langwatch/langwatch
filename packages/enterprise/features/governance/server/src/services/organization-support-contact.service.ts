// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * "Contact your admin", resolved for one organization.
 *
 * Two readings of the same question, kept apart because their answers are not
 * interchangeable: {@link resolveSupportContact} may return free text or a URL
 * and is for DISPLAY, {@link resolveOrgAdminEmail} is strictly an address and
 * is what a budget-increase request is actually sent to.
 *
 * They live beside the governance CLI family because that family is what asks:
 * a budget refusal tells a person who to go to, and an organization that has
 * configured nobody gets no name rather than a guess.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * The first ADMIN member's email for an organization, or nothing.
 *
 * Membership rows and users are read separately on purpose. The `user`
 * relation is backed by no database foreign key (the schema runs
 * `relationMode = "prisma"`), so an `OrganizationUser` can outlive the `User`
 * it points at. Asking for a required relation join makes a single dangling
 * row reject the whole read with "Inconsistent query result: Field user is
 * required to return data, got null instead". Orphaned memberships are skipped
 * instead, and the first admin that still resolves to a user with an email
 * wins.
 *
 * Nothing when the organization has no admin membership, or when every admin
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

/**
 * The user-facing "contact your admin" string for an organization.
 *
 * Prefers the admin-configured `Organization.supportContact` — free text, so
 * an email, a URL or a short instruction all work — and falls back to the
 * first admin member's email so organizations that never set the override keep
 * working.
 *
 * Nothing when neither resolves: an organization with no admin members yet has
 * no contact to surface, and inventing one would send a blocked person
 * nowhere.
 */
export async function resolveSupportContact({
  prisma,
  organizationId,
}: {
  prisma: PrismaClient;
  organizationId: string;
}): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { supportContact: true },
  });
  const trimmed = org?.supportContact?.trim();
  if (trimmed) return trimmed;

  return resolveOrgAdminEmail({ prisma, organizationId });
}
