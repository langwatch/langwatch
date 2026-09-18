import { findProfiles, findSink, reportFailure } from "./nurturing-sink-registry-service.rules.ts";
import type { CioOrgTraits, CioPersonTraits } from "@langwatch/enterprise-billing-contract";
import { nowInstant } from "@langwatch/time";

/**
 * Tracks which users have had a full CIO profile sync this process lifetime.
 */
const syncedUserIds = new Set<string>();

/**
 * Queries the database for the user's full profile and sends it to Customer.io.
 * Only called on first login per process lifetime.
 */
async function performFullSync({ userId }: { userId: string }): Promise<void> {
  const nurturing = findSink();
  if (!nurturing) {
    return;
  }

  const profiles = findProfiles();
  if (!profiles) {
    return;
  }

  const profile = await profiles.findProfile(userId);
  if (!profile) {
    return;
  }

  const { user, organization: org, hasTraces, hasSubscription } = profile;
  const signupData = org.signupData;

  const traits: Partial<CioPersonTraits> = {
    ...(user.email ? { email: user.email } : {}),
    ...(user.name ? { name: user.name } : {}),
    ...(signupData.yourRole ? { role: signupData.yourRole as string } : {}),
    ...(signupData.companySize ? { company_size: signupData.companySize as string } : {}),
    has_traces: hasTraces,
    has_subscription: hasSubscription,
    createdAt: user.createdAt.toString({ fractionalSecondDigits: 3 }),
    last_active_at: nowInstant().toString({ fractionalSecondDigits: 3 }),
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

/**
 * Ensures a user's full profile is synced to Customer.io at least once per process
 * lifetime.
 */
export function ensureUserSynced({
  userId,
  hasOrganization,
}: {
  userId: string;
  hasOrganization: boolean;
}): void {
  const nurturing = findSink();
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
    reportFailure(error);
  });
}

/**
 * Resets the sync cache. Only exposed for testing.
 * @internal
 */
export function resetCache(): void {
  syncedUserIds.clear();
}

/**
 * Returns the size of the sync cache for testing.
 * @internal
 */
export function cacheSize(): number {
  return syncedUserIds.size;
}
