import { Currency, type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { createLogger } from "../../../src/utils/logger";
import { getApp } from "../../../src/server/app-layer/app";
import type {
  SubscriptionRepository,
  SubscriptionWithOrg,
} from "../../../src/server/app-layer/subscription/subscription.repository";
import type { OrganizationRepository } from "../../../src/server/app-layer/organizations/repositories/organization.repository";
import { PrismaOrganizationRepository } from "../../../src/server/app-layer/organizations/repositories/organization.prisma.repository";
import { PrismaSubscriptionRepository } from "./subscription.repository";
import { SubscriptionStatus } from "../planTypes";
import type { calculateQuantityForPrice, prices } from "./subscriptionItemCalculator";
import { isGrowthEventsPrice, isGrowthSeatEventPlan, isGrowthSeatPrice } from "../utils/growthSeatEvent";
import { SubscriptionRecordNotFoundError } from "../errors";
import { traced } from "../../../src/server/app-layer/tracing";
import { fireSubscriptionSyncNurturing } from "../nurturing/hooks/subscriptionSync";

const logger = createLogger("langwatch:billing:webhookService");

type ItemCalculator = {
  calculateQuantityForPrice: typeof calculateQuantityForPrice;
  prices: typeof prices;
};

type InviteApprover = {
  approvePaymentPendingInvites(params: {
    subscriptionId: string;
    organizationId: string;
  }): Promise<unknown>;
};

/** Stripe webhooks can arrive before subscription state is fully consistent. */
const STRIPE_EVENTUAL_CONSISTENCY_DELAY_MS = 2000;
// TECH-DEBT: This fixed delay should become a retry loop with backoff.
const waitForStripeConsistency = () =>
  new Promise((resolve) => setTimeout(resolve, STRIPE_EVENTUAL_CONSISTENCY_DELAY_MS));

export type WebhookService = {
  handleCheckoutCompleted(params: {
    subscriptionId: string;
    clientReferenceId: string | null;
    selectedCurrency?: string | null;
  }): Promise<{ earlyReturn: boolean }>;

  handleInvoicePaymentSucceeded(params: {
    subscriptionId: string;
    throwOnMissing?: boolean;
  }): Promise<void>;

  handleInvoicePaymentFailed(params: {
    subscriptionId: string;
  }): Promise<void>;

  handleSubscriptionDeleted(params: {
    stripeSubscriptionId: string;
  }): Promise<void>;

  handleSubscriptionUpdated(params: {
    subscription: Stripe.Subscription;
  }): Promise<void>;
};

export class EEWebhookService implements WebhookService {
  private readonly subscriptionRepository: SubscriptionRepository;
  private readonly organizationRepository: OrganizationRepository;
  private readonly stripe: Stripe;
  private readonly itemCalculator: ItemCalculator;
  private readonly inviteApprover?: InviteApprover;

  constructor({
    subscriptionRepository,
    organizationRepository,
    stripe,
    itemCalculator,
    inviteApprover,
  }: {
    subscriptionRepository: SubscriptionRepository;
    organizationRepository: OrganizationRepository;
    stripe: Stripe;
    itemCalculator: ItemCalculator;
    inviteApprover?: InviteApprover;
  }) {
    this.subscriptionRepository = subscriptionRepository;
    this.organizationRepository = organizationRepository;
    this.stripe = stripe;
    this.itemCalculator = itemCalculator;
    this.inviteApprover = inviteApprover;
  }

  static create({
    db,
    stripe,
    itemCalculator,
    inviteApprover,
  }: {
    db: PrismaClient;
    stripe: Stripe;
    itemCalculator: ItemCalculator;
    inviteApprover?: InviteApprover;
  }): WebhookService {
    return traced(
      new EEWebhookService({
        subscriptionRepository: new PrismaSubscriptionRepository(db),
        organizationRepository: new PrismaOrganizationRepository(db),
        stripe,
        itemCalculator,
        inviteApprover,
      }),
      "EEWebhookService",
    );
  }

  async handleCheckoutCompleted({
    subscriptionId,
    clientReferenceId,
    selectedCurrency,
  }: {
    subscriptionId: string;
    clientReferenceId: string | null;
    selectedCurrency?: string | null;
  }): Promise<{ earlyReturn: boolean }> {
    const subscriptionClientReferenceId = clientReferenceId?.replace(
      "subscription_setup_",
      "",
    );

    if (!subscriptionClientReferenceId) {
      return { earlyReturn: true };
    }

    const updateResult = await this.subscriptionRepository.linkStripeId({
      id: subscriptionClientReferenceId,
      stripeSubscriptionId: subscriptionId,
    });

    if (updateResult.count === 0) {
      logger.error(
        { subscriptionClientReferenceId },
        "[stripeWebhook] No subscription found for checkout",
      );
      throw new SubscriptionRecordNotFoundError(
        subscriptionClientReferenceId,
      );
    }

    await this.syncInvoicePaymentSuccess({
      subscriptionId,
      throwOnMissing: true,
    });

    const subscriptionRecord = await this.subscriptionRepository.findByStripeId(subscriptionId);

    const normalizedCurrency = this.normalizeSelectedCurrency(selectedCurrency);
    if (normalizedCurrency && subscriptionRecord) {
      try {
        await this.organizationRepository.updateCurrency({
          organizationId: subscriptionRecord.organizationId,
          currency: normalizedCurrency,
        });
      } catch (err) {
        logger.warn(
          { subscriptionId, selectedCurrency: normalizedCurrency, err },
          "[stripeWebhook] Failed to persist selected currency on checkout completion",
        );
      }
    }

    // Approve PAYMENT_PENDING invites linked to this subscription
    if (this.inviteApprover && subscriptionRecord) {
      try {
        await this.inviteApprover.approvePaymentPendingInvites({
          subscriptionId: subscriptionRecord.id,
          organizationId: subscriptionRecord.organizationId,
        });
      } catch (err) {
        logger.error(
          { subscriptionId, err },
          "[stripeWebhook] Failed to approve PAYMENT_PENDING invites after checkout, manual resolution may be needed",
        );
      }
    }

    // Cancel any active trial subscriptions for this org
    if (subscriptionRecord) {
      await this.subscriptionRepository.cancelTrialSubscriptions(
        subscriptionRecord.organizationId,
      );
    }

    return { earlyReturn: false };
  }

  async handleInvoicePaymentSucceeded({
    subscriptionId,
    throwOnMissing,
  }: {
    subscriptionId: string;
    throwOnMissing?: boolean;
  }): Promise<void> {
    await this.syncInvoicePaymentSuccess({ subscriptionId, throwOnMissing });
  }

  async handleInvoicePaymentFailed({
    subscriptionId,
  }: {
    subscriptionId: string;
  }): Promise<void> {
    await waitForStripeConsistency();

    const currentSubscription =
      await this.subscriptionRepository.findByStripeId(subscriptionId);

    if (!currentSubscription) {
      logger.warn(
        { subscriptionId },
        "[stripeWebhook] No subscription record for payment failure, skipping",
      );
      return;
    }

    await this.subscriptionRepository.recordPaymentFailure({
      id: currentSubscription.id,
      currentStatus: currentSubscription.status,
    });
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

    const remainingActive = await this.subscriptionRepository.findLastNonCancelled(
      existingSubscription.organizationId,
    );
    fireSubscriptionSyncNurturing({
      organizationId: existingSubscription.organizationId,
      hasSubscription: !!remainingActive,
    });
  }

  async handleSubscriptionUpdated({
    subscription,
  }: {
    subscription: Stripe.Subscription;
  }): Promise<void> {
    await waitForStripeConsistency();

    const existingSubForUpdate =
      await this.subscriptionRepository.findByStripeId(subscription.id);

    if (!existingSubForUpdate) {
      logger.warn(
        { stripeSubscriptionId: subscription.id },
        "[stripeWebhook] No subscription for update event, skipping",
      );
      return;
    }

    if (
      subscription.status !== "active" ||
      subscription.ended_at
    ) {
      // Truly cancelled or ended — mark as CANCELLED in DB.
      // Note: canceled_at alone means "scheduled for cancellation at period end"
      // — the sub is still active until then, so we don't cancel in DB yet.
      // When the period ends, Stripe fires `customer.subscription.deleted`
      // which is handled by handleSubscriptionDeleted.
      await this.subscriptionRepository.cancel({ id: existingSubForUpdate.id });

      const remainingActive = await this.subscriptionRepository.findLastNonCancelled(
        existingSubForUpdate.organizationId,
      );
      fireSubscriptionSyncNurturing({
        organizationId: existingSubForUpdate.organizationId,
        hasSubscription: !!remainingActive,
      });
    } else if (subscription.status === "active") {
      const shouldNotify =
        existingSubForUpdate.status !== SubscriptionStatus.ACTIVE;

      let tracesQuantity: number | null = null;
      let usersQuantity: number | null = null;

      for (const item of subscription.items.data) {
        if (isGrowthSeatPrice(item.price.id)) {
          usersQuantity = item.quantity ?? 0;
        } else if (isGrowthEventsPrice(item.price.id)) {
          // Events price exists on the subscription; traces limit comes from plan limits
        } else if (
          item.price.id === this.itemCalculator.prices.LAUNCH_USERS ||
          item.price.id === this.itemCalculator.prices.ACCELERATE_USERS ||
          item.price.id === this.itemCalculator.prices.LAUNCH_ANNUAL_USERS ||
          item.price.id ===
            this.itemCalculator.prices.ACCELERATE_ANNUAL_USERS
        ) {
          const calculateQuantity =
            this.itemCalculator.calculateQuantityForPrice({
              priceId: item.price.id,
              quantity: item.quantity ?? 0,
              plan: existingSubForUpdate.plan,
            });
          usersQuantity = calculateQuantity;
        } else if (
          item.price.id ===
            this.itemCalculator.prices.ACCELERATE_TRACES_100K ||
          item.price.id === this.itemCalculator.prices.LAUNCH_TRACES_10K ||
          item.price.id ===
            this.itemCalculator.prices.LAUNCH_ANNUAL_TRACES_10K ||
          item.price.id ===
            this.itemCalculator.prices.ACCELERATE_ANNUAL_TRACES_100K
        ) {
          const calculateQuantity =
            this.itemCalculator.calculateQuantityForPrice({
              priceId: item.price.id,
              quantity: item.quantity ?? 0,
              plan: existingSubForUpdate.plan,
            });
          tracesQuantity = calculateQuantity;
        }
      }

      const updatedSubscription = await this.subscriptionRepository.updateQuantities({
        id: existingSubForUpdate.id,
        maxMembers: usersQuantity,
        maxMessagesPerMonth: tracesQuantity,
      });

      if (!updatedSubscription) {
        return;
      }

      await this.clearTrialLicenseIfPresent(updatedSubscription, "subscription updated to active");

      if (shouldNotify) {
        await getApp().notifications.sendSlackSubscriptionEvent({
          type: "confirmed",
          organizationId: updatedSubscription.organizationId,
          organizationName: updatedSubscription.organization.name,
          plan: updatedSubscription.plan,
          subscriptionId: updatedSubscription.id,
          startDate: updatedSubscription.startDate,
          maxMembers: updatedSubscription.maxMembers,
          maxMessagesPerMonth: updatedSubscription.maxMessagesPerMonth,
        });
      }
    }
  }

  // --- Private helpers ---

  private async syncInvoicePaymentSuccess({
    subscriptionId,
    throwOnMissing = false,
  }: {
    subscriptionId: string;
    throwOnMissing?: boolean;
  }) {
    await waitForStripeConsistency();

    const previousSubscription =
      await this.subscriptionRepository.findByStripeId(subscriptionId);

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

    const updatedSubscription = await this.subscriptionRepository.activate({
      id: previousSubscription.id,
      previousStatus: previousSubscription.status,
    });

    if (!updatedSubscription) {
      return;
    }

    if (previousSubscription.status !== SubscriptionStatus.ACTIVE) {
      await this.clearTrialLicenseIfPresent(updatedSubscription, "subscription activated");

      if (isGrowthSeatEventPlan(updatedSubscription.plan)) {
        const oldSubscriptions = await this.subscriptionRepository.migrateToSeatEvent({
          organizationId: updatedSubscription.organizationId,
          excludeSubscriptionId: updatedSubscription.id,
        });

        // Cancel in Stripe after DB is consistent (outside transaction)
        for (const oldSub of oldSubscriptions) {
          if (oldSub.stripeSubscriptionId) {
            try {
              await this.stripe.subscriptions.cancel(oldSub.stripeSubscriptionId, {
                prorate: true,
              });
            } catch (err) {
              logger.error(
                { stripeSubscriptionId: oldSub.stripeSubscriptionId, err },
                "[stripeWebhook] CRITICAL: Failed to cancel old Stripe subscription during upgrade. Manual intervention required.",
              );
            }
          }
        }
      }

      await getApp().notifications.sendSlackSubscriptionEvent({
        type: "confirmed",
        organizationId: updatedSubscription.organizationId,
        organizationName: updatedSubscription.organization.name,
        plan: updatedSubscription.plan,
        subscriptionId: updatedSubscription.id,
        startDate: updatedSubscription.startDate,
        maxMembers: updatedSubscription.maxMembers,
        maxMessagesPerMonth: updatedSubscription.maxMessagesPerMonth,
      });

      fireSubscriptionSyncNurturing({
        organizationId: updatedSubscription.organizationId,
        hasSubscription: true,
      });
    }
  }

  private async clearTrialLicenseIfPresent(
    updatedSubscription: SubscriptionWithOrg,
    reason: string,
  ) {
    if (!updatedSubscription.organization.license) return;
    logger.info(
      { organizationId: updatedSubscription.organizationId },
      `[stripeWebhook] Clearing trial license — ${reason}`,
    );
    await this.organizationRepository.clearTrialLicense(
      updatedSubscription.organizationId,
    );
  }

  private normalizeSelectedCurrency(value?: string | null): Currency | null {
    if (value === Currency.EUR || value === Currency.USD) {
      return value;
    }
    return null;
  }
}
