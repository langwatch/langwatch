// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { BillingProductAnalyticsChannel } from "../channels/billing-product-analytics.channel.ts";
import type { BillingErrorReporter } from "./billing-error-reporter.service.ts";

type BillingSubscriptionStartedAnalyticsDeps = Readonly<{
  /** Absent where the deployment named no PostHog key. */
  analytics: BillingProductAnalyticsChannel | undefined;
  /** The organization's members, read only for their ids. */
  organizations: {
    getAllMembers(input: { organizationId: string }): Promise<readonly Readonly<{ id: string }>[]>;
  };
  errors: BillingErrorReporter;
}>;

/**
 * Tracks the PostHog subscription_started event for every member of an organization whose
 * subscription just became active.
 *
 * The event goes to each member because PostHog funnels follow a person: the member who
 * arrived from a campaign is rarely the one who paid. Count distinct organization_id for the
 * number of subscriptions started.
 *
 * Called on the transition to active only, never on a renewal. Fire-and-forget: never throws,
 * never blocks the webhook handler.
 *
 * @see specs/analytics/posthog-campaign-conversion.feature
 */
export class BillingSubscriptionStartedAnalyticsService {
  static create(
    deps: BillingSubscriptionStartedAnalyticsDeps,
  ): BillingSubscriptionStartedAnalyticsService {
    return new BillingSubscriptionStartedAnalyticsService(deps);
  }

  private constructor(private readonly deps: BillingSubscriptionStartedAnalyticsDeps) {}

  fire({ organizationId, plan }: { organizationId: string; plan: string }): void {
    const { analytics } = this.deps;
    if (!analytics) return;

    void this.#track({ analytics, organizationId, plan }).catch((error: unknown) => {
      this.deps.errors.capture(error instanceof Error ? error : new Error(String(error)), {
        handler: "subscriptionStartedAnalytics",
        organizationId,
      });
    });
  }

  async #track({
    analytics,
    organizationId,
    plan,
  }: {
    analytics: BillingProductAnalyticsChannel;
    organizationId: string;
    plan: string;
  }): Promise<void> {
    const members = await this.deps.organizations.getAllMembers({ organizationId });

    for (const { id: userId } of members) {
      analytics.track({
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
}
