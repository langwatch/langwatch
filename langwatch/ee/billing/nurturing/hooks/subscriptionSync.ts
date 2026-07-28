import { getApp } from "../../../../src/server/app-layer/app";
import { prisma } from "../../../../src/server/db";
import { captureException } from "../../../../src/utils/posthogErrorCapture";
import { resolveCioPlanLabel } from "../planLabel";

/**
 * Syncs has_subscription + plan traits to Customer.io for all members of an
 * organization.
 *
 * Called from the Stripe webhook service when a subscription is activated or
 * cancelled. The `plan` is the internal plan type of the now-current
 * subscription (null when none remains, i.e. the org has reverted to free).
 *
 * Fire-and-forget: never throws, never blocks the webhook handler.
 */
export function fireSubscriptionSyncNurturing({
  organizationId,
  hasSubscription,
  plan,
}: {
  organizationId: string;
  hasSubscription: boolean;
  plan?: string | null;
}): void {
  const nurturing = getApp().nurturing;
  if (!nurturing) return;

  void syncSubscriptionTrait({ organizationId, hasSubscription, plan }).catch(
    captureException,
  );
}

async function syncSubscriptionTrait({
  organizationId,
  hasSubscription,
  plan,
}: {
  organizationId: string;
  hasSubscription: boolean;
  plan?: string | null;
}): Promise<void> {
  const nurturing = getApp().nurturing;
  if (!nurturing) return;

  // No active subscription means the org is back on free, regardless of the
  // last plan we saw on the cancelled record.
  const planLabel = resolveCioPlanLabel(hasSubscription ? plan : null);

  const orgUsers = await prisma.organizationUser.findMany({
    where: { organizationId },
    select: { userId: true },
  });

  await Promise.all([
    ...orgUsers.map((ou) =>
      nurturing.identifyUser({
        userId: ou.userId,
        traits: { has_subscription: hasSubscription, plan: planLabel },
      }),
    ),
    // Keep the org-level plan trait in sync too. groupUser requires a userId for
    // the person↔group association; any member works.
    ...(orgUsers[0]
      ? [
          nurturing.groupUser({
            userId: orgUsers[0].userId,
            groupId: organizationId,
            traits: { plan: planLabel },
          }),
        ]
      : []),
  ]);
}
