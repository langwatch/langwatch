import {
  reportNurturingFailure,
  tryNurturingProfiles,
  tryNurturingSink,
} from "../adapters/nurturing-sink.adapter";

async function syncSubscriptionTrait({
  organizationId,
  hasSubscription,
}: {
  organizationId: string;
  hasSubscription: boolean;
}): Promise<void> {
  const nurturing = tryNurturingSink();
  if (!nurturing) {
    return;
  }

  const profiles = tryNurturingProfiles();
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

export class NurturingSubscriptionSyncService {
  static create(): NurturingSubscriptionSyncService {
    return new NurturingSubscriptionSyncService();
  }

  /**
   * Syncs has_subscription trait to Customer.io for all members of an organization.
   */
  static fireSubscriptionSync({
    organizationId,
    hasSubscription,
  }: {
    organizationId: string;
    hasSubscription: boolean;
  }): void {
    const nurturing = tryNurturingSink();
    if (!nurturing) {
      return;
    }

    void syncSubscriptionTrait({ organizationId, hasSubscription }).catch(reportNurturingFailure);
  }
}
