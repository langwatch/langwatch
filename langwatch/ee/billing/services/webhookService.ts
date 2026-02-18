import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { createLogger } from "../../../src/utils/logger";
import { notifySubscriptionEvent } from "../notifications/notificationHandlers";
import { SubscriptionStatus } from "../planTypes";
import type { calculateQuantityForPrice, prices } from "./subscriptionItemCalculator";

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
  itemCalculator,
}: {
  db: PrismaClient;
  itemCalculator: ItemCalculator;
}): WebhookService => {
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
        throw new Error(
          `Subscription record not found for ${subscriptionId} after checkout`,
        );
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

  return {
    async handleCheckoutCompleted({ subscriptionId, clientReferenceId }) {
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
        throw new Error(
          `No subscription found with id ${subscriptionClientReferenceId}`,
        );
      }

      await syncInvoicePaymentSuccess({
        subscriptionId,
        throwOnMissing: true,
      });
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

      await db.subscription.update({
        where: { id: existingSubscription.id },
        data: {
          status: SubscriptionStatus.CANCELLED,
          endDate: new Date(),
          maxMembers: null,
          maxMessagesPerMonth: null,
          maxProjects: null,
          evaluationsCredit: null,
        },
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
        subscription.canceled_at ||
        subscription.ended_at
      ) {
        await db.subscription.update({
          where: { id: existingSubForUpdate.id },
          data: {
            status: SubscriptionStatus.CANCELLED,
            endDate: new Date(),
            maxMembers: null,
            maxMessagesPerMonth: null,
            maxProjects: null,
            evaluationsCredit: null,
          },
        });
      } else if (subscription.status === "active") {
        const shouldNotify =
          existingSubForUpdate.status !== SubscriptionStatus.ACTIVE;

        let tracesQuantity: number | null = null;
        let usersQuantity: number | null = null;

        for (const item of subscription.items.data) {
          const calculateQuantity =
            itemCalculator.calculateQuantityForPrice({
              priceId: item.price.id,
              quantity: item.quantity ?? 0,
              plan: existingSubForUpdate.plan,
            });

          if (
            item.price.id === itemCalculator.prices.LAUNCH_USERS ||
            item.price.id === itemCalculator.prices.ACCELERATE_USERS ||
            item.price.id === itemCalculator.prices.LAUNCH_ANNUAL_USERS ||
            item.price.id ===
              itemCalculator.prices.ACCELERATE_ANNUAL_USERS
          ) {
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
