import type { CioOrgTraits, CioPersonTraits } from "@langwatch/enterprise-billing-contract";
import { parseGuidedOnboardingState, parseOnboardingVariant } from "@langwatch/onboarding-contract";
import { nowInstant } from "@langwatch/time";

import {
  guidedOnboardingOrgTraits,
  guidedOnboardingPersonTraits,
} from "./nurturing-guided-onboarding-service.rules.ts";
import { findProfiles, findSink, reportFailure } from "./nurturing-sink-registry-service.rules.ts";

/**
 * Users backfilled with a full profile this process lifetime. Process-local:
 * each multi-instance pod resyncs on first login, harmless since identify
 * is idempotent.
 */
const syncedUserIds = new Set<string>();

/**
 * The onboarding traits of an organization, for the person and for the
 * organization group. An organization that recorded no variant predates the
 * experiment and gets no onboarding trait at all.
 */
function readGuidedOnboardingTraits(signupData: unknown): {
  person: Partial<CioPersonTraits>;
  org: Partial<CioOrgTraits>;
} {
  const variant = parseOnboardingVariant(signupData);
  if (!variant) return { person: {}, org: {} };
  const state = parseGuidedOnboardingState(signupData);
  return {
    person: guidedOnboardingPersonTraits({ variant, state }),
    org: guidedOnboardingOrgTraits({ variant, state }),
  };
}

/**
 * Reads the user's full profile through the registered reader and sends it
 * to Customer.io. Only called on first login per process lifetime.
 */
async function performFullSync({ userId }: { userId: string }): Promise<void> {
  const nurturing = findSink();
  if (!nurturing) return;

  const profiles = findProfiles();
  if (!profiles) return;

  const profile = await profiles.findProfile(userId);
  if (!profile) return;

  const signupData = profile.organization.signupData;
  const guidedOnboarding = readGuidedOnboardingTraits(signupData);

  const traits: Partial<CioPersonTraits> = {
    ...(profile.user.email ? { email: profile.user.email } : {}),
    ...(profile.user.name ? { name: profile.user.name } : {}),
    ...guidedOnboarding.person,
    has_traces: profile.hasTraces,
    has_subscription: profile.hasSubscription,
    createdAt: profile.user.createdAt.toString(),
    last_active_at: nowInstant().toString({ fractionalSecondDigits: 3 }),
  };

  const orgTraits: Partial<CioOrgTraits> = {
    name: profile.organization.name,
    ...guidedOnboarding.org,
  };

  await Promise.all([
    nurturing.identifyUser({ userId, traits }),
    nurturing.groupUser({ userId, groupId: profile.organization.id, traits: orgTraits }),
  ]);
}

/**
 * Ensures a user's full profile is synced to Customer.io at least once per
 * process lifetime; every later call this lifetime is a no-op. Fire-and-forget.
 */
export function ensureUserSynced({
  userId,
  hasOrganization,
}: {
  userId: string;
  /** False when onboarding incomplete; skips identify to avoid ghosts. */
  hasOrganization: boolean;
}): void {
  const nurturing = findSink();
  if (!nurturing) return;
  if (!hasOrganization) return;
  if (syncedUserIds.has(userId)) return;

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
export function resetUserSyncCache(): void {
  syncedUserIds.clear();
}

/**
 * Returns the size of the sync cache for testing.
 * @internal
 */
export function userSyncCacheSize(): number {
  return syncedUserIds.size;
}
