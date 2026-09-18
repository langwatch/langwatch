import { findProfiles, findSink, reportFailure } from "./nurturing-sink-registry-service.rules.ts";

async function syncSubscriptionTrait({
  organizationId,
  hasSubscription,
}: {
  organizationId: string;
  hasSubscription: boolean;
}): Promise<void> {
  const nurturing = findSink();
  if (!nurturing) {
    return;
  }

  const profiles = findProfiles();
  if (!profiles) {
    return;
  }

  const memberUserIds = await profiles.memberUserIds(organizationId);

  await Promise.all(
    memberUserIds.map((userId) =>
      nurturing.identifyUser({
        userId,
        traits: { has_subscription: hasSubscription },
      }),
    ),
  );
}

/**
 * Syncs has_subscription trait to Customer.io for all members of an organization.
 */
export function fireSubscriptionSync({
  organizationId,
  hasSubscription,
}: {
  organizationId: string;
  hasSubscription: boolean;
}): void {
  const nurturing = findSink();
  if (!nurturing) {
    return;
  }

  void syncSubscriptionTrait({ organizationId, hasSubscription }).catch(reportFailure);
}
