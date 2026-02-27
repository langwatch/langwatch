import { Currency, type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { createLogger } from "../../../src/utils/logger";
import { notifySubscriptionEvent } from "../notifications/notificationHandlers";
import { NUMERIC_OVERRIDE_FIELDS } from "../planOverrideFields";
import { PlanTypes, SubscriptionStatus } from "../planTypes";
import type { calculateQuantityForPrice, prices } from "./subscriptionItemCalculator";
import { isGrowthEventsPrice, isGrowthSeatEventPlan, isGrowthSeatPrice } from "../utils/growthSeatEvent";
import { SubscriptionRecordNotFoundError } from "../errors";

const logger = createLogger("langwatch:billing:webhookService");

type ItemCalculator = {
  calculateQuantityForPrice: typeof calculateQuantityForPrice;
  prices: typeof prices;
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

export const createWebhookService = ({
  db,
  stripe,
  itemCalculator,
  inviteApprover,
}: {
  db: PrismaClient;
  stripe: Stripe;
  itemCalculator: ItemCalculator;
  inviteApprover?: {
    approvePaymentPendingInvites(params: {
      subscriptionId: string;
      organizationId: string;
    }): Promise<unknown>;
  };
}): WebhookService => {
  const normalizeSelectedCurrency = (value?: string | null): Currency | null => {
    if (value === Currency.EUR || value === Currency.USD) {
      return value;
    }
    return null;
  };

  const syncInvoicePaymentSuccess = async ({
    subscriptionId,
    throwOnMissing = false,
  }: {
    subscriptionId: string;
    throwOnMissing?: boolean;
  }) => {
    await waitForStripeConsistency();

    const previousSubscription = await db.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
      select: { id: true, status: true },
    });

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

    const updatedSubscription = await db.subscription.update({
      where: { id: previousSubscription.id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        ...(previousSubscription.status !== SubscriptionStatus.ACTIVE && {
          startDate: new Date(),
        }),
        lastPaymentFailedDate: null,
      },
      include: { organization: true },
    });

    if (previousSubscription.status !== SubscriptionStatus.ACTIVE) {
      if (isGrowthSeatEventPlan(updatedSubscription.plan)) {
        const TIERED_PLAN_TYPES: PlanTypes[] = [
          PlanTypes.LAUNCH,
          PlanTypes.ACCELERATE,
          PlanTypes.LAUNCH_ANNUAL,
          PlanTypes.ACCELERATE_ANNUAL,
          PlanTypes.PRO,
          PlanTypes.GROWTH,
        ];

        const oldSubscriptions = await db.$transaction(async (tx) => {
          await tx.organization.update({
            where: { id: updatedSubscription.organizationId },
            data: { pricingModel: "SEAT_EVENT" },
          });

          const oldSubs = await tx.subscription.findMany({
            where: {
              organizationId: updatedSubscription.organizationId,
              id: { not: updatedSubscription.id },
              status: { not: SubscriptionStatus.CANCELLED },
              stripeSubscriptionId: { not: null },
              plan: { in: TIERED_PLAN_TYPES },
            },
          });

          // Mark CANCELLED in DB first, before Stripe call
          for (const oldSub of oldSubs) {
            await tx.subscription.update({
              where: { id: oldSub.id },
              data: { status: SubscriptionStatus.CANCELLED, endDate: new Date() },
            });
          }
          return oldSubs;
        });

        // Cancel in Stripe after DB is consistent (outside transaction)
        for (const oldSub of oldSubscriptions) {
          if (oldSub.stripeSubscriptionId) {
            try {
              await stripe.subscriptions.cancel(oldSub.stripeSubscriptionId, {
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

      await notifySubscriptionEvent({
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
  };

  const buildCancellationUpdate = () => ({
    status: SubscriptionStatus.CANCELLED,
    endDate: new Date(),
    ...Object.fromEntries(NUMERIC_OVERRIDE_FIELDS.map((f) => [f, null])),
  });

  return {
    async handleCheckoutCompleted({
      subscriptionId,
      clientReferenceId,
      selectedCurrency,
    }) {
      const subscriptionClientReferenceId = clientReferenceId?.replace(
        "subscription_setup_",
        "",
      );

      if (!subscriptionClientReferenceId) {
        return { earlyReturn: true };
      }

      const updateResult = await db.subscription.updateMany({
        where: { id: subscriptionClientReferenceId },
        data: { stripeSubscriptionId: subscriptionId },
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

      await syncInvoicePaymentSuccess({
        subscriptionId,
        throwOnMissing: true,
      });

      const subscriptionRecord =
        normalizeSelectedCurrency(selectedCurrency) || inviteApprover
          ? await db.subscription.findUnique({
              where: { stripeSubscriptionId: subscriptionId },
              select: { id: true, organizationId: true },
            })
          : null;

      const normalizedCurrency = normalizeSelectedCurrency(selectedCurrency);
      if (normalizedCurrency && subscriptionRecord) {
        try {
          await db.organization.update({
            where: { id: subscriptionRecord.organizationId },
            data: { currency: normalizedCurrency },
          });
        } catch (err) {
          logger.warn(
            { subscriptionId, selectedCurrency: normalizedCurrency, err },
            "[stripeWebhook] Failed to persist selected currency on checkout completion",
          );
        }
      }

      // Approve PAYMENT_PENDING invites linked to this subscription
      if (inviteApprover && subscriptionRecord) {
        try {
          await inviteApprover.approvePaymentPendingInvites({
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

      return { earlyReturn: false };
    },

    async handleInvoicePaymentSucceeded({ subscriptionId, throwOnMissing }) {
      await syncInvoicePaymentSuccess({ subscriptionId, throwOnMissing });
    },

    async handleInvoicePaymentFailed({ subscriptionId }) {
      await waitForStripeConsistency();

      const currentSubscription = await db.subscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      });

      if (!currentSubscription) {
        logger.warn(
          { subscriptionId },
          "[stripeWebhook] No subscription record for payment failure, skipping",
        );
        return;
      }

      await db.subscription.update({
        where: { id: currentSubscription.id },
        data: {
          status:
            currentSubscription.status === SubscriptionStatus.ACTIVE
              ? SubscriptionStatus.ACTIVE
              : SubscriptionStatus.FAILED,
          lastPaymentFailedDate: new Date(),
        },
      });
    },

    async handleSubscriptionDeleted({ stripeSubscriptionId }) {
      const existingSubscription = await db.subscription.findUnique({
        where: { stripeSubscriptionId },
      });
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

      await db.subscription.update({
        where: { id: existingSubscription.id },
        data: buildCancellationUpdate(),
      });
    },

    async handleSubscriptionUpdated({ subscription }) {
      await waitForStripeConsistency();

      const existingSubForUpdate = await db.subscription.findUnique({
        where: { stripeSubscriptionId: subscription.id },
      });
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
        await db.subscription.update({
          where: { id: existingSubForUpdate.id },
          data: buildCancellationUpdate(),
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
            item.price.id === itemCalculator.prices.LAUNCH_USERS ||
            item.price.id === itemCalculator.prices.ACCELERATE_USERS ||
            item.price.id === itemCalculator.prices.LAUNCH_ANNUAL_USERS ||
            item.price.id ===
              itemCalculator.prices.ACCELERATE_ANNUAL_USERS
          ) {
            const calculateQuantity =
              itemCalculator.calculateQuantityForPrice({
                priceId: item.price.id,
                quantity: item.quantity ?? 0,
                plan: existingSubForUpdate.plan,
              });
            usersQuantity = calculateQuantity;
          } else if (
            item.price.id ===
              itemCalculator.prices.ACCELERATE_TRACES_100K ||
            item.price.id === itemCalculator.prices.LAUNCH_TRACES_10K ||
            item.price.id ===
              itemCalculator.prices.LAUNCH_ANNUAL_TRACES_10K ||
            item.price.id ===
              itemCalculator.prices.ACCELERATE_ANNUAL_TRACES_100K
          ) {
            const calculateQuantity =
              itemCalculator.calculateQuantityForPrice({
                priceId: item.price.id,
                quantity: item.quantity ?? 0,
                plan: existingSubForUpdate.plan,
              });
            tracesQuantity = calculateQuantity;
          }
        }

        const updatedSubscription = await db.subscription.update({
          where: { id: existingSubForUpdate.id },
          data: {
            status: SubscriptionStatus.ACTIVE,
            lastPaymentFailedDate: null,
            maxMembers: usersQuantity,
            maxMessagesPerMonth: tracesQuantity,
          },
          include: { organization: true },
        });

        if (shouldNotify) {
          await notifySubscriptionEvent({
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
    },
  };
};
