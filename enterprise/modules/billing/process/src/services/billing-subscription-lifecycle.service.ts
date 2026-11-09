// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a Stripe subscription's own lifecycle events do to our records: deletion, update, and
 * the payment-success sync that reconciles quantities and the seat policy. Data-retention stamps
 * a seat plan's retention from the started fact (round 37 D4).
 */
import {
  isGrowthEventsPrice,
  isGrowthSeatEventPlan,
  isGrowthSeatPrice,
  SubscriptionRecordNotFoundError,
  SubscriptionStatus,
} from "@langwatch/enterprise-billing-contract";
import type { StripePriceMap } from "@langwatch/enterprise-billing-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { createLogger } from "@langwatch/observability";
import { planQuantities, planQuantitiesOf } from "@langwatch/plans";
import { nowInstant } from "@langwatch/time";
import type Stripe from "stripe";

import type { BillingWebhookHost } from "../channels/billing-webhook-host.channel.ts";
import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";
import type { BillingWebhookOrganizationRepository } from "../repositories/billing-webhook-organization.repository.ts";
import type {
  BillingWebhookSubscriptionRepository,
  SubscriptionWithOrg,
} from "../repositories/billing-webhook-subscription.repository.ts";
import type { BillingSubscriptionRecord } from "../repositories/subscription.repository.ts";
import { BestEffortService } from "./best-effort.service.ts";
import type { BillingLifecycleAnnouncerService } from "./billing-lifecycle-announcer.service.ts";
import type { SubscriptionItemCalculatorService } from "./subscription-item-calculator.service.ts";

const logger = createLogger("langwatch:billing:subscriptionLifecycle");

/** Stripe reads its own writes eventually; a webhook can arrive before the write settles. */
const STRIPE_EVENTUAL_CONSISTENCY_DELAY_MS = 2000;

const waitForStripeConsistency = () =>
  new Promise((resolve) => setTimeout(resolve, STRIPE_EVENTUAL_CONSISTENCY_DELAY_MS));

type BillingSubscriptionLifecycleOptions = {
  subscriptionRepository: BillingWebhookSubscriptionRepository;
  organizationRepository: BillingWebhookOrganizationRepository;
  /** Clears a trial's licence once its subscription activates; organization owns the row. */
  licenses: LicenseClearer;
  stripeSubscriptions: Pick<StripeSubscriptionsChannel, "getSubscription">;
  itemCalculator: Pick<SubscriptionItemCalculatorService, "calculateQuantityForPrice"> & {
    prices: StripePriceMap;
  };
  host: BillingWebhookHost;
  /** Records subscription changes for peers; absent where nothing composes a lifecycle. */
  announcer?: Pick<
    BillingLifecycleAnnouncerService,
    | "subscriptionActivated"
    | "subscriptionCancelled"
    | "pricingModelChanged"
    | "supersededPlansFound"
  >;
};

/** What a subscription activation asks licensing about a trial's licence, and its removal. */
export type LicenseClearer = Pick<LicensingApi, "removeLicense" | "getLicenseStatus">;

export class BillingSubscriptionLifecycleService {
  static create(options: BillingSubscriptionLifecycleOptions): BillingSubscriptionLifecycleService {
    return new BillingSubscriptionLifecycleService(options);
  }

  private readonly subscriptionRepository: BillingWebhookSubscriptionRepository;
  private readonly organizationRepository: BillingWebhookOrganizationRepository;
  private readonly licenses: LicenseClearer;
  private readonly stripeSubscriptions: BillingSubscriptionLifecycleOptions["stripeSubscriptions"];
  private readonly itemCalculator: BillingSubscriptionLifecycleOptions["itemCalculator"];
  private readonly host: BillingWebhookHost;
  private readonly announcer: BillingSubscriptionLifecycleOptions["announcer"];
  private readonly bestEffort = BestEffortService.create();

  private constructor(options: BillingSubscriptionLifecycleOptions) {
    this.subscriptionRepository = options.subscriptionRepository;
    this.organizationRepository = options.organizationRepository;
    this.licenses = options.licenses;
    this.stripeSubscriptions = options.stripeSubscriptions;
    this.itemCalculator = options.itemCalculator;
    this.host = options.host;
    this.announcer = options.announcer;
  }

  async handleSubscriptionDeleted({
    stripeSubscriptionId,
  }: {
    stripeSubscriptionId: string;
  }): Promise<void> {
    await waitForStripeConsistency();

    const existingSubscription =
      await this.subscriptionRepository.findByStripeId(stripeSubscriptionId);

    if (!existingSubscription) {
      logger.warn(
        { stripeSubscriptionId },
        "[stripeWebhook] No subscription for deletion event, skipping",
      );

      return;
    }

    // Idempotency: if already CANCELLED (e.g., by upgrade flow), skip redundant update
    if (existingSubscription.status === SubscriptionStatus.CANCELLED) {
      logger.info(
        { stripeSubscriptionId },
        "[stripeWebhook] Subscription already cancelled, skipping redundant update",
      );

      return;
    }

    await this.subscriptionRepository.cancel({ id: existingSubscription.id });
    await this.announcer?.subscriptionCancelled({
      organizationId: existingSubscription.organizationId,
    });

    await this.bestEffort.run({
      label: "cancellation notification",
      context: { stripeSubscriptionId },
      effect: async () => {
        const org = await this.organizationRepository.findNameById(
          existingSubscription.organizationId,
        );
        await this.host.sendSlackSubscriptionEvent({
          type: "cancelled",
          organizationId: existingSubscription.organizationId,
          organizationName: org?.name ?? "Unknown",
          plan: existingSubscription.plan,
          subscriptionId: existingSubscription.id,
          cancellationDate: nowInstant(),
        });
      },
    });

    // Cancellation deliberately leaves the org's retention policies in place
    // until the paid-retention feature is released.
  }

  async handleSubscriptionUpdated({
    subscription,
  }: {
    subscription: Stripe.Subscription;
  }): Promise<void> {
    await waitForStripeConsistency();

    const existingSubForUpdate = await this.subscriptionRepository.findByStripeId(subscription.id);

    if (!existingSubForUpdate) {
      logger.warn(
        { stripeSubscriptionId: subscription.id },
        "[stripeWebhook] No subscription for update event, skipping",
      );

      return;
    }

    if (subscription.status !== "active" || subscription.ended_at) {
      await this.cancelSubscriptionRecord(existingSubForUpdate);

      return;
    }

    if (subscription.status === "active") {
      await this.applyActiveSubscriptionUpdate({ subscription, existing: existingSubForUpdate });
    }
  }

  /**
   * Truly cancelled or ended. `canceled_at` alone means "scheduled for cancellation at period
   * end" — the subscription is still active until then, so it is not cancelled here; Stripe
   * fires `customer.subscription.deleted` when the period ends. Cancellation deliberately
   * leaves the organization's retention policies in place until paid retention ships.
   */
  private async cancelSubscriptionRecord(existing: BillingSubscriptionRecord): Promise<void> {
    await this.subscriptionRepository.cancel({ id: existing.id });
    await this.announcer?.subscriptionCancelled({ organizationId: existing.organizationId });
  }

  /** Reconciles the seat and event quantities Stripe now reports, and notifies on activation. */
  private async applyActiveSubscriptionUpdate({
    subscription,
    existing,
  }: {
    subscription: Stripe.Subscription;
    existing: BillingSubscriptionRecord;
  }): Promise<void> {
    if (
      existing.status === SubscriptionStatus.CANCELLED &&
      !(await this.isActiveAtStripe(existing))
    ) {
      logger.info(
        { subscriptionId: existing.id },
        "[stripeWebhook] Active update for a cancelled subscription Stripe no longer reports active, skipping",
      );
      return;
    }
    const shouldNotify = existing.status !== SubscriptionStatus.ACTIVE;
    const { usersQuantity, tracesQuantity } = this.quantitiesOf({ subscription, existing });
    const quantitiesResult = await this.subscriptionRepository.updateQuantities({
      id: existing.id,
      ...planQuantities({ members: usersQuantity, messagesPerMonth: tracesQuantity }),
    });
    if (quantitiesResult.outcome === "missing_subscription") {
      return;
    }
    const updatedSubscription = quantitiesResult.subscription;

    await this.clearTrialLicenseIfPresent(updatedSubscription, "subscription updated to active");
    if (shouldNotify) await this.announceSubscriptionStarted(updatedSubscription);
    // Stripe may report the seat subscription active here before the invoice is paid, and
    // the invoice path then sees an active subscription; the retirement cannot wait for it.
    await this.recordSeatEventMove({ updated: updatedSubscription, activated: shouldNotify });
  }

  /**
   * Stripe delivers out of order, so an active update for a row we cancelled may be stale. Only a
   * subscription Stripe still reports active restores the row, matching how a non-active update
   * cancels it; a failed read throws so Stripe redelivers.
   */
  private async isActiveAtStripe(existing: BillingSubscriptionRecord): Promise<boolean> {
    if (!existing.stripeSubscriptionId) return false;
    const atStripe = await this.stripeSubscriptions.getSubscription({
      subscriptionId: existing.stripeSubscriptionId,
    });
    return atStripe.status === "active";
  }

  /**
   * Reports a subscription that just became active: the Slack confirmation and the lifecycle
   * records peers react to. Callers gate this on the transition to active, so a renewal
   * reports nothing.
   */
  private async announceSubscriptionStarted(subscription: SubscriptionWithOrg): Promise<void> {
    await this.bestEffort.run({
      label: "subscription confirmed notification",
      context: { subscriptionId: subscription.id },
      effect: () =>
        this.host.sendSlackSubscriptionEvent({
          type: "confirmed",
          organizationId: subscription.organizationId,
          organizationName: subscription.organization.name,
          plan: subscription.plan,
          subscriptionId: subscription.id,
          startDate: subscription.startDate,
          ...planQuantitiesOf(subscription),
        }),
    });
    await this.announcer?.subscriptionActivated({
      organizationId: subscription.organizationId,
      subscriptionId: subscription.id,
      plan: subscription.plan,
    });
  }

  /** The seat and trace limits the subscription's own line items imply. */
  private quantitiesOf({
    subscription,
    existing,
  }: {
    subscription: Stripe.Subscription;
    existing: BillingSubscriptionRecord;
  }): { usersQuantity: number | null; tracesQuantity: number | null } {
    const prices = this.itemCalculator.prices;
    let tracesQuantity: number | null = null;
    let usersQuantity: number | null = null;
    const seatPrices = [
      prices.LAUNCH_USERS,
      prices.ACCELERATE_USERS,
      prices.LAUNCH_ANNUAL_USERS,
      prices.ACCELERATE_ANNUAL_USERS,
    ];
    const tracePrices = [
      prices.ACCELERATE_TRACES_100K,
      prices.LAUNCH_TRACES_10K,
      prices.LAUNCH_ANNUAL_TRACES_10K,
      prices.ACCELERATE_ANNUAL_TRACES_100K,
    ];

    for (const item of subscription.items.data) {
      // An events price exists on the subscription, but the traces limit comes
      // from the plan limits rather than from the line item.
      if (isGrowthSeatPrice(item.price.id, prices)) {
        usersQuantity = item.quantity ?? 0;
      } else if (isGrowthEventsPrice(item.price.id, prices)) {
        continue;
      } else if (seatPrices.includes(item.price.id)) {
        usersQuantity = this.itemCalculator.calculateQuantityForPrice({
          priceId: item.price.id,
          quantity: item.quantity ?? 0,
          plan: existing.plan,
        });
      } else if (tracePrices.includes(item.price.id)) {
        tracesQuantity = this.itemCalculator.calculateQuantityForPrice({
          priceId: item.price.id,
          quantity: item.quantity ?? 0,
          plan: existing.plan,
        });
      }
    }

    return { usersQuantity, tracesQuantity };
  }

  // --- Private helpers ---

  async syncInvoicePaymentSuccess({
    subscriptionId,
    throwOnMissing = false,
  }: {
    subscriptionId: string;
    throwOnMissing?: boolean;
  }): Promise<void> {
    await waitForStripeConsistency();

    const previousSubscription = await this.subscriptionRepository.findByStripeId(subscriptionId);

    if (!previousSubscription) {
      if (throwOnMissing) {
        throw new SubscriptionRecordNotFoundError(subscriptionId);
      }

      logger.warn(
        { subscriptionId },
        "[stripeWebhook] No subscription record found, skipping sync",
      );

      return;
    }

    if (!(await this.mayActivateFromInvoice({ subscriptionId, previousSubscription }))) {
      return;
    }

    const activationResult = await this.subscriptionRepository.activate({
      id: previousSubscription.id,
      previousStatus: previousSubscription.status,
    });

    if (activationResult.outcome === "missing_subscription") {
      return;
    }
    const updatedSubscription = activationResult.subscription;

    const activated = previousSubscription.status !== SubscriptionStatus.ACTIVE;
    // Announced first, once: a redelivery after a failed record must not announce again.
    if (activated) {
      await this.clearTrialLicenseIfPresent(updatedSubscription, "subscription activated");
      await this.announceSubscriptionStarted(updatedSubscription);
    }
    // Every paid invoice re-checks: a redelivery after a failed record, or a renewal of an
    // organization still billed for its old plan, asks again for what is still alive.
    await this.recordSeatEventMove({ updated: updatedSubscription, activated });
  }

  /**
   * A $0 invoice generated during cancellation must not reactivate the subscription: Stripe
   * fires `invoice.payment_succeeded` for $0 prorated invoices even while it is being
   * cancelled, so the authoritative Stripe status decides.
   */
  private async mayActivateFromInvoice({
    subscriptionId,
    previousSubscription,
  }: {
    subscriptionId: string;
    previousSubscription: BillingSubscriptionRecord;
  }): Promise<boolean> {
    try {
      const stripeSubscription = await this.stripeSubscriptions.getSubscription({
        subscriptionId,
      });
      if (stripeSubscription.status !== "canceled") {
        return true;
      }

      logger.info(
        { subscriptionId },
        "[stripeWebhook] Stripe subscription is canceled, skipping activation from $0 invoice",
      );

      return false;
    } catch (err) {
      logger.warn(
        { subscriptionId, err },
        "[stripeWebhook] Failed to verify Stripe subscription status, proceeding with activation",
      );

      if (previousSubscription.status !== SubscriptionStatus.CANCELLED) {
        return true;
      }

      logger.info(
        { subscriptionId },
        "[stripeWebhook] Stripe status unavailable and DB is CANCELLED, skipping activation",
      );

      return false;
    }
  }

  /**
   * A Growth seat subscription moves the organization to seat pricing on activation, and on
   * every active confirmation records the live tiered plans it supersedes; the lifecycle
   * pipeline's process manager retires them. Throws, so Stripe redelivers a lost record.
   */
  private async recordSeatEventMove({
    updated,
    activated,
  }: {
    updated: SubscriptionWithOrg;
    activated: boolean;
  }): Promise<void> {
    if (!isGrowthSeatEventPlan(updated.plan)) return;
    if (activated) {
      await this.announcer?.pricingModelChanged({
        organizationId: updated.organizationId,
        pricingModel: "SEAT_EVENT",
      });
    }
    if (!updated.stripeSubscriptionId) return;
    const superseded = await this.subscriptionRepository.findSupersededBySeatEvent({
      organizationId: updated.organizationId,
      excludeSubscriptionId: updated.id,
    });
    if (superseded.length === 0) return;
    await this.announcer?.supersededPlansFound({
      organizationId: updated.organizationId,
      seatStripeSubscriptionId: updated.stripeSubscriptionId,
    });
  }

  private async clearTrialLicenseIfPresent(
    updatedSubscription: SubscriptionWithOrg,
    reason: string,
  ) {
    const { hasLicense } = await this.licenses.getLicenseStatus(updatedSubscription.organizationId);
    if (!hasLicense) return;

    logger.info(
      { organizationId: updatedSubscription.organizationId },
      `[stripeWebhook] Clearing trial license — ${reason}`,
    );
    await this.licenses.removeLicense(updatedSubscription.organizationId);
  }
}
