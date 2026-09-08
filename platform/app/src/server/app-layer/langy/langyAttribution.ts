import type { PrismaClient } from "~/generated/prisma/client";

/**
 * ProjectSecret / VirtualKey / ApiKey audit fields require a non-null user.
 * Runtime callers (project creation, first chat) pass the acting principal;
 * the backfill paths have no actor, so we attribute to the organization's
 * first admin. Returns null when neither exists — callers skip provisioning
 * and rely on first-chat self-healing.
 *
 * The explicit id is honoured only when it names a User row. A service key
 * acts as itself on the key-authed Langy surfaces, so the acting id there
 * names an ApiKey, which the audit columns cannot point at; that case takes
 * the same first-admin fallback the actorless paths do. This runs only when
 * something has to be provisioned, never on a turn whose credentials exist.
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
  if (explicitUserId) {
    const user = await prisma.user.findUnique({
      where: { id: explicitUserId },
      select: { id: true },
    });
    if (user) return user.id;
  }
  const admin = await prisma.organizationUser.findFirst({
    where: { organizationId, role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  return admin?.userId ?? null;
}
