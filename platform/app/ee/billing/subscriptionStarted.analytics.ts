import { prisma } from "../../src/server/db";
import { getPostHogInstance, trackServerEvent } from "../../src/server/posthog";
import { captureException } from "../../src/utils/posthogErrorCapture";

/**
 * Tracks the PostHog subscription_started event for every member of an
 * organization whose subscription just became active.
 *
 * The event goes to each member because PostHog funnels follow a person: the
 * member who arrived from a campaign is rarely the one who paid. Count
 * distinct organization_id for the number of subscriptions started.
 *
 * Called from the Stripe webhook service on the transition to active only,
 * never on a renewal. Fire-and-forget: never throws, never blocks the
 * webhook handler.
 */
export function fireSubscriptionStartedAnalytics({
  organizationId,
  plan,
}: {
  organizationId: string;
  plan: string;
}): void {
  if (!getPostHogInstance()) return;

  void trackSubscriptionStarted({ organizationId, plan }).catch(
    captureException,
  );
}

async function trackSubscriptionStarted({
  organizationId,
  plan,
}: {
  organizationId: string;
  plan: string;
}): Promise<void> {
  const orgUsers = await prisma.organizationUser.findMany({
    where: { organizationId },
    select: { userId: true },
  });

  for (const { userId } of orgUsers) {
    trackServerEvent({
      userId,
      event: "subscription_started",
      properties: {
        plan,
        organization_id: organizationId,
        $groups: { organization: organizationId },
      },
    });
  }
}
