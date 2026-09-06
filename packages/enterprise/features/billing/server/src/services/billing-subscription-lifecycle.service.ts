// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a Stripe subscription's own lifecycle events do to our records: deletion, update, and
 * the payment-success sync that reconciles quantities, retention and the seat policy.
 */
import { createLogger } from "@langwatch/observability";
import type Stripe from "stripe";
import {
  isGrowthEventsPrice,
  isGrowthSeatEventPlan,
  isGrowthSeatPrice,
  SubscriptionRecordNotFoundError,
  SubscriptionStatus,
} from "@langwatch/enterprise-billing-contract";
import {
  PLATFORM_DEFAULT_RETENTION_DAYS,
  retentionCategories,
} from "@langwatch/data-retention-contract";
import { BestEffortService } from "./best-effort.service.ts";
import { NurturingSubscriptionSyncService } from "./nurturing-subscription-sync.service.ts";
import type { SubscriptionItemCalculatorService } from "./subscription-item-calculator.service.ts";
import type { StripePriceMap } from "@langwatch/enterprise-billing-contract";
import type { BillingWebhookHostPort } from "../ports/billing-webhook-host.port.ts";
import type { BillingWebhookOrganizationPort } from "../ports/billing-webhook-organization.port.ts";
import type {
  BillingWebhookSubscriptionPort,
  SubscriptionWithOrg,
} from "../ports/billing-webhook-subscription.port.ts";
import type { BillingSubscriptionRecord } from "../ports/subscription.port.ts";

const logger = createLogger("langwatch:billing:subscriptionLifecycle");

/** Stripe reads its own writes eventually; a webhook can arrive before the write settles. */
const STRIPE_EVENTUAL_CONSISTENCY_DELAY_MS = 2000;

const waitForStripeConsistency = () =>
  new Promise((resolve) => setTimeout(resolve, STRIPE_EVENTUAL_CONSISTENCY_DELAY_MS));

type BillingSubscriptionLifecycleOptions = {
  subscriptionRepository: BillingWebhookSubscriptionPort;
  organizationRepository: BillingWebhookOrganizationPort;
  stripe: Stripe;
  itemCalculator: Pick<SubscriptionItemCalculatorService, "calculateQuantityForPrice"> & {
    prices: StripePriceMap;
  };
  host: BillingWebhookHostPort;
};

export class BillingSubscriptionLifecycleService {
  static create(options: BillingSubscriptionLifecycleOptions): BillingSubscriptionLifecycleService {
    return new BillingSubscriptionLifecycleService(options);
  }

  private readonly subscriptionRepository: BillingWebhookSubscriptionPort;
  private readonly organizationRepository: BillingWebhookOrganizationPort;
  private readonly stripe: Stripe;
  private readonly itemCalculator: BillingSubscriptionLifecycleOptions["itemCalculator"];
  private readonly host: BillingWebhookHostPort;
  private readonly bestEffort = BestEffortService.create();

  private constructor(options: BillingSubscriptionLifecycleOptions) {
    this.subscriptionRepository = options.subscriptionRepository;
    this.organizationRepository = options.organizationRepository;
    this.stripe = options.stripe;
    this.itemCalculator = options.itemCalculator;
    this.host = options.host;
  }

  async handleSubscriptionDeleted({
    stripeSubscriptionId,
  }: {
    stripeSubscriptionId: string;
  }): Promise<void> {
    await waitForStripeConsistency();

    const existingSubscription =
      await this.subscriptionRepository.tryFindByStripeId(stripeSubscriptionId);

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

    await this.bestEffort.run({
      label: "cancellation notification",
      context: { stripeSubscriptionId },
      effect: async () => {
        const org = await this.organizationRepository.tryFindNameById(
          existingSubscription.organizationId,
        );
        await this.host.sendSlackSubscriptionEvent({
          type: "cancelled",
          organizationId: existingSubscription.organizationId,
          organizationName: org?.name ?? "Unknown",
          plan: existingSubscription.plan,
          subscriptionId: existingSubscription.id,
          cancellationDate: new Date(),
        });
      },
    });

    const remainingActive = await this.subscriptionRepository.tryFindLastNonCancelled(
      existingSubscription.organizationId,
    );
    NurturingSubscriptionSyncService.fireSubscriptionSync({
      organizationId: existingSubscription.organizationId,
      hasSubscription: !!remainingActive,
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

    const existingSubForUpdate = await this.subscriptionRepository.tryFindByStripeId(
      subscription.id,
    );

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

    const remainingActive = await this.subscriptionRepository.tryFindLastNonCancelled(
      existing.organizationId,
    );
    NurturingSubscriptionSyncService.fireSubscriptionSync({
      organizationId: existing.organizationId,
      hasSubscription: !!remainingActive,
    });
  }

  /** Reconciles the seat and event quantities Stripe now reports, and notifies on activation. */
  private async applyActiveSubscriptionUpdate({
    subscription,
    existing,
  }: {
    subscription: Stripe.Subscription;
    existing: BillingSubscriptionRecord;
  }): Promise<void> {
    const shouldNotify = existing.status !== SubscriptionStatus.ACTIVE;
    const { usersQuantity, tracesQuantity } = this.quantitiesOf({ subscription, existing });
    const updatedSubscription = await this.subscriptionRepository.tryUpdateQuantities({
      id: existing.id,
      maxMembers: usersQuantity,
      maxMessagesPerMonth: tracesQuantity,
    });
    if (!updatedSubscription) {
      return;
    }

    await this.clearTrialLicenseIfPresent(updatedSubscription, "subscription updated to active");
    if (!shouldNotify) {
      return;
    }

    await this.bestEffort.run({
      label: "subscription confirmed notification",
      context: { subscriptionId: updatedSubscription.id },
      effect: () =>
        this.host.sendSlackSubscriptionEvent({
          type: "confirmed",
          organizationId: updatedSubscription.organizationId,
          organizationName: updatedSubscription.organization.name,
          plan: updatedSubscription.plan,
          subscriptionId: updatedSubscription.id,
          startDate: updatedSubscription.startDate,
          maxMembers: updatedSubscription.maxMembers,
          maxMessagesPerMonth: updatedSubscription.maxMessagesPerMonth,
        }),
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

    const previousSubscription =
      await this.subscriptionRepository.tryFindByStripeId(subscriptionId);

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

    const updatedSubscription = await this.subscriptionRepository.tryActivate({
      id: previousSubscription.id,
      previousStatus: previousSubscription.status,
    });

    if (!updatedSubscription) {
      return;
    }

    if (previousSubscription.status !== SubscriptionStatus.ACTIVE) {
      await this.clearTrialLicenseIfPresent(updatedSubscription, "subscription activated");

      if (isGrowthSeatEventPlan(updatedSubscription.plan)) {
        await this.migrateToSeatEventPlan(updatedSubscription);
      }

      await this.bestEffort.run({
        label: "subscription confirmed notification",
        context: { subscriptionId: updatedSubscription.id },
        effect: () =>
          this.host.sendSlackSubscriptionEvent({
            type: "confirmed",
            organizationId: updatedSubscription.organizationId,
            organizationName: updatedSubscription.organization.name,
            plan: updatedSubscription.plan,
            subscriptionId: updatedSubscription.id,
            startDate: updatedSubscription.startDate,
            maxMembers: updatedSubscription.maxMembers,
            maxMessagesPerMonth: updatedSubscription.maxMessagesPerMonth,
          }),
      });

      NurturingSubscriptionSyncService.fireSubscriptionSync({
        organizationId: updatedSubscription.organizationId,
        hasSubscription: true,
      });
    }
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
      const stripeSubscription = await this.stripe.subscriptions.retrieve(subscriptionId);
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

  /** Retires the plans this seat-event subscription supersedes, once the records agree. */
  private async migrateToSeatEventPlan(updated: SubscriptionWithOrg): Promise<void> {
    const oldSubscriptions = await this.subscriptionRepository.migrateToSeatEvent({
      organizationId: updated.organizationId,
      excludeSubscriptionId: updated.id,
    });

    // Cancel in Stripe after the records are consistent, outside the transaction.
    for (const oldSub of oldSubscriptions) {
      if (!oldSub.stripeSubscriptionId) {
        continue;
      }

      try {
        await this.stripe.subscriptions.cancel(oldSub.stripeSubscriptionId, { prorate: true });
      } catch (err) {
        logger.error(
          { stripeSubscriptionId: oldSub.stripeSubscriptionId, err },
          "[stripeWebhook] CRITICAL: Failed to cancel old Stripe subscription during " +
            "upgrade. Manual intervention required.",
        );
      }
    }

    await this.applySeatRetentionPolicy(updated.organizationId);
  }

  /**
   * A paid Growth-Seat subscription entitles the org to explicit per-category
   * retention policies at the platform default (49 days), stamped on first
   * activation. Create-if-absent; best-effort — never fails the Stripe webhook.
   */
  private async applySeatRetentionPolicy(organizationId: string): Promise<void> {
    // Create-if-absent, NOT upsert: a seat/subscription event must never
    // overwrite an existing org-level override, which could clobber a
    // grandfathered high policy down to 49d and DELETE data. Mirrors
    // licenseHandler.provisionMissingRetentionPolicies.
    let covered: Set<string>;
    try {
      const existing = await this.host.listOrganizationRetentionRules({
        organizationId,
      });
      covered = new Set(
        existing
          .filter((row) => row.scopeType === "ORGANIZATION" && row.scopeId === organizationId)
          .map((row) => row.category),
      );
    } catch (err) {
      // If we can't read the current rules we can't prove a category is absent,
      // so skip provisioning rather than risk a clobber. Ingestion still stamps
      // PLATFORM_DEFAULT_RETENTION_DAYS via the cascade fallback.
      logger.error(
        { organizationId, err },
        "[stripeWebhook] Failed to read retention rules; skipping seat provisioning",
      );

      return;
    }

    for (const category of retentionCategories) {
      if (covered.has(category)) {
        continue;
      }

      try {
        await this.host.setOrganizationRetention({
          scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
          category,
          retentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
        });
      } catch (err) {
        logger.error(
          { organizationId, category, err },
          "[stripeWebhook] Failed to apply seat retention policy",
        );
      }
    }
  }

  private async clearTrialLicenseIfPresent(
    updatedSubscription: SubscriptionWithOrg,
    reason: string,
  ) {
    if (!updatedSubscription.organization.license) {
      return;
    }

    logger.info(
      { organizationId: updatedSubscription.organizationId },
      `[stripeWebhook] Clearing trial license — ${reason}`,
    );
    await this.organizationRepository.clearTrialLicense(updatedSubscription.organizationId);
  }
}
