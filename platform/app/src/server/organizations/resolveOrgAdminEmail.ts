import type { PrismaClient } from "@prisma/client";

/**
 * Resolves the first ADMIN member's email for an org. Strictly an email
 * — used as the recipient when we need to actually SEND email (eg.
 * budget-increase requests). Distinct from [[resolveSupportContact]]
 * which may return a URL or free text intended for user display.
 */
export async function resolveOrgAdminEmail({
  prisma,
  organizationId,
}: {
  prisma: PrismaClient;
  organizationId: string;
}): Promise<string | null> {
  const admin = await prisma.organizationUser.findFirst({
    where: { organizationId, role: "ADMIN" },
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return admin?.user.email ?? null;
}
