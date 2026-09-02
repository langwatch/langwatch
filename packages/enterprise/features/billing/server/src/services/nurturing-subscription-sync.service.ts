import { reportNurturingFailure, tryNurturingDatabase, tryNurturingSink } from "./nurturing-sink";

/**
 * Syncs has_subscription trait to Customer.io for all members of an organization.
 *
 * Called from the Stripe webhook service when a subscription is activated or cancelled.
 * Fire-and-forget: never throws, never blocks the webhook handler.
 */
export function fireSubscriptionSyncNurturing({
  organizationId,
  hasSubscription,
}: {
  organizationId: string;
  hasSubscription: boolean;
}): void {
  const nurturing = tryNurturingSink();
  if (!nurturing) return;

  void syncSubscriptionTrait({ organizationId, hasSubscription }).catch(reportNurturingFailure);
}

async function syncSubscriptionTrait({
  organizationId,
  hasSubscription,
}: {
  organizationId: string;
  hasSubscription: boolean;
}): Promise<void> {
  const nurturing = tryNurturingSink();
  if (!nurturing) return;
  const database = tryNurturingDatabase();
  if (!database) return;

  const orgUsers = await database.organizationUser.findMany({
    where: { organizationId },
    select: { userId: true },
  });

  await Promise.all(
    orgUsers.map((ou) =>
      nurturing.identifyUser({
        userId: ou.userId,
        traits: { has_subscription: hasSubscription },
      }),
    ),
  );
}
