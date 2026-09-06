import { getApp } from "../../../../src/server/app-layer/app";
import { prisma } from "../../../../src/server/db";
import { captureException } from "../../../../src/utils/posthogErrorCapture";

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
  const nurturing = getApp().nurturing;
  if (!nurturing) return;

  void syncSubscriptionTrait({ organizationId, hasSubscription }).catch(
    captureException,
  );
}

async function syncSubscriptionTrait({
  organizationId,
  hasSubscription,
}: {
  organizationId: string;
  hasSubscription: boolean;
}): Promise<void> {
  const nurturing = getApp().nurturing;
  if (!nurturing) return;

  const orgUsers = await prisma.organizationUser.findMany({
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
