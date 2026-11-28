// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createLogger } from "@langwatch/observability";

import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";
import type { BillingWebhookSubscriptionRepository } from "../repositories/billing-webhook-subscription.repository.ts";
import type { BillingLifecycleAnnouncerService } from "./billing-lifecycle-announcer.service.ts";
import type { DuplicateSubscriptionAlerts } from "./duplicate-subscription-alert.service.ts";

const logger = createLogger("langwatch:billing:checkoutCompletion");

/** Who the audit names when billing moves or refuses a paid checkout on its own. */
export const CHECKOUT_ADOPTION_ACTOR = "system:billing";

type SecondPlanRefusalOptions = {
  subscriptions: Pick<
    BillingWebhookSubscriptionRepository,
    "findLiveLinkedBeside" | "linkStripeId" | "cancel"
  >;
  stripeSubscriptions: Pick<
    StripeSubscriptionsChannel,
    "getSubscription" | "cancelSubscription" | "refundLatestInvoice"
  >;
  announcer?: Pick<BillingLifecycleAnnouncerService, "audited" | "seatCheckoutsAbandoned">;
  /** Ops hear about a second paid seat checkout; absent, nobody does. */
  duplicates?: DuplicateSubscriptionAlerts;
};

/** Undoes a paid checkout that would sit beside the organization's live Stripe-backed plan. */
export class SecondPlanRefusalService {
  static create(options: SecondPlanRefusalOptions): SecondPlanRefusalService {
    return new SecondPlanRefusalService(options);
  }

  private readonly subscriptions: SecondPlanRefusalOptions["subscriptions"];
  private readonly stripeSubscriptions: SecondPlanRefusalOptions["stripeSubscriptions"];
  private readonly announcer: SecondPlanRefusalOptions["announcer"];
  private readonly duplicates: DuplicateSubscriptionAlerts | undefined;

  private constructor(options: SecondPlanRefusalOptions) {
    this.subscriptions = options.subscriptions;
    this.stripeSubscriptions = options.stripeSubscriptions;
    this.announcer = options.announcer;
    this.duplicates = options.duplicates;
  }

  /**
   * A checkout paid while the organization already holds a linked seat plan (a stale tab, two
   * admins at once) would start a second plan. Its subscription is cancelled and its payment
   * given back, its row is kept cancelled with the link, and ops are told.
   */
  async refuse({
    pendingId,
    stripeSubscriptionId,
  }: {
    pendingId: string;
    stripeSubscriptionId: string;
  }): Promise<boolean> {
    const live = await this.subscriptions.findLiveLinkedBeside({ pendingId });
    const [kept] = live;
    if (!kept) return false;
    const { organizationId } = kept;
    logger.error(
      { organizationId, pendingId, keptId: kept.id, stripeSubscriptionId },
      "[stripeWebhook] Second seat checkout paid beside a live plan; cancelling and refunding it",
    );
    await this.announcer?.audited({
      tenantId: organizationId,
      userId: CHECKOUT_ADOPTION_ACTOR,
      action: "subscription.refuseSecondCheckout",
      args: { pendingId, keptId: kept.id, stripeSubscriptionId },
      targetKind: "organization",
      targetId: organizationId,
    });
    const current = await this.stripeSubscriptions.getSubscription({
      subscriptionId: stripeSubscriptionId,
    });
    if (current.status !== "canceled") {
      await this.stripeSubscriptions.cancelSubscription({
        subscriptionId: stripeSubscriptionId,
        prorate: false,
      });
    }
    await this.giveBackPayment({ organizationId, stripeSubscriptionId });
    await this.subscriptions.linkStripeId({ id: pendingId, stripeSubscriptionId });
    await this.subscriptions.cancel({ id: pendingId });
    await this.announcer?.seatCheckoutsAbandoned({ organizationId, subscriptionIds: [pendingId] });
    await this.duplicates?.reportDuplicateActive({
      organizationId,
      subscriptionIds: [...live.map((row) => row.id), pendingId],
    });
    return true;
  }

  /** A refused give-back is left to ops, who the duplicate alert already names it to. */
  private async giveBackPayment({
    organizationId,
    stripeSubscriptionId,
  }: {
    organizationId: string;
    stripeSubscriptionId: string;
  }): Promise<void> {
    try {
      const outcome = await this.stripeSubscriptions.refundLatestInvoice({
        subscriptionId: stripeSubscriptionId,
      });
      logger.warn(
        { organizationId, stripeSubscriptionId, outcome },
        "[stripeWebhook] Second checkout's payment given back",
      );
    } catch (err) {
      logger.error(
        { organizationId, stripeSubscriptionId, err },
        "[stripeWebhook] CRITICAL: could not refund a second seat checkout; refund it in Stripe",
      );
    }
  }
}
