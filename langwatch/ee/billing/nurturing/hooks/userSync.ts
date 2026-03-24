import { getApp } from "../../../../src/server/app-layer/app";
import { prisma } from "../../../../src/server/db";
import { captureException } from "../../../../src/utils/posthogErrorCapture";
import type { CioPersonTraits, CioOrgTraits } from "../types";

/**
 * Tracks which users have had a full CIO profile sync this process lifetime.
 *
 * On first login after server restart, we send the complete profile so that
 * existing users (who signed up before nurturing was deployed) get backfilled.
 * Since CIO identify is idempotent, re-syncing after restart is harmless.
 *
 * NOTE: process-local. In multi-instance deployments each pod syncs
 * independently on first login — acceptable because identify is idempotent.
 */
const syncedUserIds = new Set<string>();

/**
 * Ensures a user's full profile is synced to Customer.io at least once
 * per process lifetime.
 *
 * On first login after server restart: queries Prisma for user + org + project
 * data, then calls identifyUser with full traits and groupUser for org
 * association. Subsequent logins skip entirely.
 *
 * Fire-and-forget: never throws, never blocks the session callback.
 */
export function ensureUserSyncedToCio({
  userId,
  hasOrganization,
}: {
  userId: string;
  hasOrganization: boolean;
}): void {
  const nurturing = getApp().nurturing;
  if (!nurturing) return;
  if (!hasOrganization) return;
  if (syncedUserIds.has(userId)) return;

  void performFullSync({ userId }).catch((error) => {
    captureException(error);
  });
}

/**
 * Queries the database for the user's full profile and sends it to Customer.io.
 * Only called on first login per process lifetime.
 */
async function performFullSync({ userId }: { userId: string }): Promise<void> {
  const nurturing = getApp().nurturing;
  if (!nurturing) return;

  const [user, orgUser] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, createdAt: true },
    }),
    prisma.organizationUser.findFirst({
      where: { userId },
      select: { organizationId: true, role: true },
    }),
  ]);

  if (!user || !orgUser) return;

  const [org, projects] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgUser.organizationId },
      select: { id: true, name: true, signupData: true },
    }),
    prisma.project.findMany({
      where: {
        team: {
          organization: { id: orgUser.organizationId },
        },
      },
      select: { firstMessage: true, integrated: true },
    }),
  ]);

  if (!org) return;

  const signupData = (org.signupData ?? {}) as Record<string, unknown>;
  const hasTraces = projects.some((p) => p.firstMessage);

  const traits: Partial<CioPersonTraits> = {
    ...(user.email ? { email: user.email } : {}),
    ...(user.name ? { name: user.name } : {}),
    ...(signupData.yourRole ? { role: signupData.yourRole as string } : {}),
    ...(signupData.companySize
      ? { company_size: signupData.companySize as string }
      : {}),
    has_traces: hasTraces,
    createdAt: user.createdAt.toISOString(),
    last_active_at: new Date().toISOString(),
  };

  const orgTraits: Partial<CioOrgTraits> = {
    name: org.name,
    ...(signupData.companySize
      ? { company_size: signupData.companySize as string }
      : {}),
  };

  await Promise.all([
    nurturing.identifyUser({ userId, traits }),
    nurturing.groupUser({
      userId,
      groupId: org.id,
      traits: orgTraits,
    }),
  ]);

  syncedUserIds.add(userId);
}

/**
 * Resets the sync cache. Only exposed for testing.
 * @internal
 */
export function resetUserSyncCache(): void {
  syncedUserIds.clear();
}

/**
 * Returns the size of the sync cache for testing.
 * @internal
 */
export function getUserSyncCacheSize(): number {
  return syncedUserIds.size;
}
