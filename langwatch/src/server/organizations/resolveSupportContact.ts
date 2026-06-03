import type { PrismaClient } from "@prisma/client";

/**
 * Resolves the user-facing "contact your admin" string for an org. Prefers
 * the admin-configured `Organization.supportContact` (free text — email,
 * URL, or short instruction). Falls back to the first ADMIN member's
 * email so legacy orgs that never set the override keep working.
 *
 * Returns null when neither resolves (eg. an org with zero admin members
 * yet has no contact to surface).
 *
 * Used by /api/auth/cli/* (in-CLI "contact your admin" copy) and the
 * personal /me budget surface (BudgetExceededBanner).
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

  const admin = await prisma.organizationUser.findFirst({
    where: { organizationId, role: "ADMIN" },
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return admin?.user.email ?? null;
}
