import type {
  BillingInterval,
  Currency,
  createCheckoutLineItems,
} from "@langwatch/enterprise-billing-contract";
import { nowInstant, Temporal } from "@langwatch/time";

import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";

/** The provider checkout session a growth-seat checkout sends the customer to. */
export class SeatCheckoutSessionService {
  private constructor(
    private readonly stripeSubscriptions: Pick<StripeSubscriptionsChannel, "createCheckoutSession">,
  ) {}

  static create({
    stripeSubscriptions,
  }: {
    stripeSubscriptions: Pick<StripeSubscriptionsChannel, "createCheckoutSession">;
  }): SeatCheckoutSessionService {
    return new SeatCheckoutSessionService(stripeSubscriptions);
  }

  /** Opens the provider checkout session, anchored to the 1st of next month. */
  async open({
    customerId,
    baseUrl,
    checkoutCurrency,
    billingInterval,
    lineItems,
    isUpgradeFromTiered,
    subscriptionId,
    startedByUserId,
  }: {
    customerId: string;
    baseUrl: string;
    checkoutCurrency: Currency;
    billingInterval: BillingInterval;
    lineItems: ReturnType<typeof createCheckoutLineItems>;
    isUpgradeFromTiered: boolean;
    subscriptionId: string;
    startedByUserId?: string;
  }): Promise<{ url: string | null }> {
    const selectedOptionsMetadata = {
      selectedCurrency: checkoutCurrency,
      selectedBillingInterval: billingInterval,
    };

    // Anchor billing cycle to the 1st of next month for all plans.
    // Customer pays prorated amount for the partial period (checkout → anchor),
    // then full price (monthly or annual) starting on the 1st.
    const now = nowInstant().toZonedDateTimeISO("UTC");
    const billingCycleAnchor = Temporal.PlainDateTime.from({
      year: now.year,
      month: now.month,
      day: 1,
    })
      .toZonedDateTime("UTC")
      .add({ months: 1 })
      .toInstant();
    const session = await this.stripeSubscriptions.createCheckoutSession({
      customerId,
      currency: checkoutCurrency.toLowerCase(),
      lineItems,
      // The starter rides on the session only: its completion grants them the Billing role.
      metadata: { ...selectedOptionsMetadata, ...(startedByUserId ? { startedByUserId } : {}) },
      subscription: {
        metadata: selectedOptionsMetadata,
        billingCycleAnchor: Math.floor(billingCycleAnchor.epochMilliseconds / 1000),
        prorationBehavior: "create_prorations",
      },
      successUrl: `${baseUrl}/settings/subscription?success${isUpgradeFromTiered ? "&upgraded_from=tiered" : ""}`,
      cancelUrl: `${baseUrl}/settings/subscription`,
      clientReferenceId: `subscription_setup_${subscriptionId}`,
      allowPromotionCodes: true,
    });

    return { url: session.url };
  }
}
