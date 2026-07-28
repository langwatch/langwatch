import type { PrismaClient } from "@prisma/client";

/**
 * ProjectSecret / VirtualKey / ApiKey audit fields require a non-null user.
 * Runtime callers (project creation, first chat) pass the acting user; the
 * backfill paths have no actor, so we attribute to the organization's first
 * admin. Returns null when neither exists — callers skip provisioning and
 * rely on first-chat self-healing.
 */
export async function resolveAttributionUserId({
  prisma,
  organizationId,
  explicitUserId = null,
}: {
  prisma: PrismaClient;
  organizationId: string;
  explicitUserId?: string | null;
}): Promise<string | null> {
  if (explicitUserId) return explicitUserId;
  const admin = await prisma.organizationUser.findFirst({
    where: { organizationId, role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  return admin?.userId ?? null;
}
