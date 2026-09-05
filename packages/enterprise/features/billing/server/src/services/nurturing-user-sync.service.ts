import { reportNurturingFailure, tryNurturingDatabase, tryNurturingSink } from "./nurturing-sink";
import type { CioOrgTraits, CioPersonTraits } from "@langwatch/enterprise-billing-contract";

/**
 * Tracks which users have had a full CIO profile sync this process lifetime.
 */
const syncedUserIds = new Set<string>();

/**
 * Queries the database for the user's full profile and sends it to Customer.io.
 * Only called on first login per process lifetime.
 */
async function performFullSync({ userId }: { userId: string }): Promise<void> {
  const nurturing = tryNurturingSink();
  if (!nurturing) {
    return;
  }

  const database = tryNurturingDatabase();
  if (!database) {
    return;
  }

  const [user, orgUser] = await Promise.all([
    database.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, createdAt: true },
    }),
    database.organizationUser.findFirst({
      where: { userId },
      select: { organizationId: true, role: true },
    }),
  ]);

  if (!user || !orgUser) {
    return;
  }

  const [org, projects, activeSubscription] = await Promise.all([
    database.organization.findUnique({
      where: { id: orgUser.organizationId },
      select: { id: true, name: true, signupData: true },
    }),
    database.project.findMany({
      where: {
        team: {
          organization: { id: orgUser.organizationId },
        },
      },
      select: { firstMessage: true, integrated: true },
    }),
    database.subscription.findFirst({
      where: {
        organizationId: orgUser.organizationId,
        status: "ACTIVE",
      },
      select: { id: true },
    }),
  ]);

  if (!org) {
    return;
  }

  const signupData = (org.signupData ?? {}) as Record<string, unknown>;
  const hasTraces = projects.some((p) => p.firstMessage);

  const traits: Partial<CioPersonTraits> = {
    ...(user.email ? { email: user.email } : {}),
    ...(user.name ? { name: user.name } : {}),
    ...(signupData.yourRole ? { role: signupData.yourRole as string } : {}),
    ...(signupData.companySize ? { company_size: signupData.companySize as string } : {}),
    has_traces: hasTraces,
    has_subscription: !!activeSubscription,
    createdAt: user.createdAt.toISOString(),
    last_active_at: new Date().toISOString(),
  };

  const orgTraits: Partial<CioOrgTraits> = {
    name: org.name,
    ...(signupData.companySize ? { company_size: signupData.companySize as string } : {}),
  };

  await Promise.all([
    nurturing.identifyUser({ userId, traits }),
    nurturing.groupUser({
      userId,
      groupId: org.id,
      traits: orgTraits,
    }),
  ]);
}

export class NurturingUserSyncService {
  static create(): NurturingUserSyncService {
    return new NurturingUserSyncService();
  }

  /**
   * Ensures a user's full profile is synced to Customer.io at least once per process
   * lifetime.
   */
  static ensureUserSynced({
    userId,
    hasOrganization,
  }: {
    userId: string;
    hasOrganization: boolean;
  }): void {
    const nurturing = tryNurturingSink();
    if (!nurturing) {
      return;
    }

    if (!hasOrganization) {
      return;
    }

    if (syncedUserIds.has(userId)) {
      return;
    }

    // Optimistic: mark as synced BEFORE async work to prevent concurrent
    // logins from both triggering a full sync. Removed on failure so the
    // next login can retry.
    syncedUserIds.add(userId);

    void performFullSync({ userId }).catch((error) => {
      syncedUserIds.delete(userId);
      reportNurturingFailure(error);
    });
  }

  /**
   * Resets the sync cache. Only exposed for testing.
   * @internal
   */
  static resetCache(): void {
    syncedUserIds.clear();
  }

  /**
   * Returns the size of the sync cache for testing.
   * @internal
   */
  static cacheSize(): number {
    return syncedUserIds.size;
  }
}
