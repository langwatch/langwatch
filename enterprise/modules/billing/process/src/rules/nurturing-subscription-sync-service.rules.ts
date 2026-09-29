import type { NurturingProfileRepository } from "../repositories/nurturing-profile.repository.ts";
import type { NurturingService } from "../services/nurturing.service.ts";
import { reportFailure } from "./nurturing-sink-registry-service.rules.ts";

async function syncSubscriptionTrait({
  nurturing,
  profiles,
  organizationId,
  hasSubscription,
}: {
  nurturing: NurturingService | undefined;
  profiles: NurturingProfileRepository | undefined;
  organizationId: string;
  hasSubscription: boolean;
}): Promise<void> {
  if (!nurturing) {
    return;
  }

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
  nurturing,
  profiles,
  organizationId,
  hasSubscription,
}: {
  nurturing: NurturingService | undefined;
  profiles: NurturingProfileRepository | undefined;
  organizationId: string;
  hasSubscription: boolean;
}): void {
  if (!nurturing) {
    return;
  }

  void syncSubscriptionTrait({ nurturing, profiles, organizationId, hasSubscription }).catch(
    reportFailure,
  );
}
