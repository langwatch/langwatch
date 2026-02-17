import { buffer } from "micro";
import type { NextApiRequest, NextApiResponse } from "next";
import type Stripe from "stripe";
import { env } from "../../src/env.mjs";
import { createLogger } from "../../src/utils/logger";
import { prisma } from "../../src/server/db";
import { notifySubscriptionEvent } from "./notificationHandlers";
import { createStripeClient } from "./stripeClient";
import {
  calculateQuantityForPrice,
  prices,
} from "./stripeHelpers";
import { SubscriptionStatus } from "./planTypes";

const logger = createLogger("langwatch:billing:stripeWebhook");

const maskCustomerId = (id: string) => `${id.slice(0, 7)}...${id.slice(-4)}`;

/** Stripe webhooks can arrive before subscription state is fully consistent. */
const STRIPE_EVENTUAL_CONSISTENCY_DELAY_MS = 2000;
// TECH-DEBT: This fixed delay should become a retry loop with backoff.
const waitForStripeConsistency = () =>
  new Promise((resolve) => setTimeout(resolve, STRIPE_EVENTUAL_CONSISTENCY_DELAY_MS));

const syncInvoicePaymentSuccess = async ({
  subscriptionId,
  throwOnMissing = false,
}: {
  subscriptionId: string;
  throwOnMissing?: boolean;
}) => {
  await waitForStripeConsistency();

  const previousSubscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true, status: true },
  });

  if (!previousSubscription) {
    if (throwOnMissing) {
      throw new Error(`Subscription record not found for ${subscriptionId} after checkout`);
    }
    logger.warn({ subscriptionId }, "[stripeWebhook] No subscription record found, skipping sync");
    return;
  }

  const updatedSubscription = await prisma.subscription.update({
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

const handleCheckoutCompleted = async ({
  subscriptionId,
  event,
}: {
  subscriptionId: string;
  event: Stripe.Event;
}) => {
  const subscriptionClientReferenceId =
    (event.data.object as Stripe.Checkout.Session).client_reference_id?.replace(
      "subscription_setup_",
      "",
    );

  if (!subscriptionClientReferenceId) {
    return { earlyReturn: true } as const;
  }

  await prisma.subscription.update({
    where: {
      id: subscriptionClientReferenceId,
    },
    data: { stripeSubscriptionId: subscriptionId },
  });

  await syncInvoicePaymentSuccess({ subscriptionId, throwOnMissing: true });
  return { earlyReturn: false } as const;
};

const handleInvoicePaymentFailed = async ({
  subscriptionId,
}: {
  subscriptionId: string;
}) => {
  await waitForStripeConsistency();

  const currentSubscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
  });

  if (!currentSubscription) {
    logger.warn({ subscriptionId }, "[stripeWebhook] No subscription record for payment failure, skipping");
    return;
  }

  await prisma.subscription.update({
    where: { id: currentSubscription.id },
    data: {
      status:
        currentSubscription.status === SubscriptionStatus.ACTIVE
          ? SubscriptionStatus.ACTIVE
          : SubscriptionStatus.FAILED,
      lastPaymentFailedDate: new Date(),
    },
  });
};

const handleSubscriptionDeleted = async ({
  subscription,
}: {
  subscription: Stripe.Subscription;
}) => {
  const existingSubscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: subscription.id },
  });
  if (!existingSubscription) {
    logger.warn({ stripeSubscriptionId: subscription.id }, "[stripeWebhook] No subscription for deletion event, skipping");
    return;
  }

  await prisma.subscription.update({
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
};

const handleSubscriptionUpdated = async ({
  subscription,
}: {
  subscription: Stripe.Subscription;
}) => {
  await waitForStripeConsistency();

  const existingSubForUpdate = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: subscription.id },
  });
  if (!existingSubForUpdate) {
    logger.warn({ stripeSubscriptionId: subscription.id }, "[stripeWebhook] No subscription for update event, skipping");
    return;
  }

  let tracesQuantity: number | null = null;
  let usersQuantity: number | null = null;

  if (
    subscription.status !== "active" ||
    subscription.canceled_at ||
    subscription.ended_at
  ) {
    await prisma.subscription.update({
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
    // Safe to reuse existingSubForUpdate: cancelled and active branches are
    // mutually exclusive, so status cannot change between fetch and here.
    const shouldNotify =
      existingSubForUpdate.status !== SubscriptionStatus.ACTIVE;

    for (const item of subscription.items.data) {
      const calculateQuantity = calculateQuantityForPrice({
        priceId: item.price.id,
        quantity: item.quantity ?? 0,
        plan: existingSubForUpdate.plan,
      });

      if (
        item.price.id === prices.LAUNCH_USERS ||
        item.price.id === prices.ACCELERATE_USERS ||
        item.price.id === prices.LAUNCH_ANNUAL_USERS ||
        item.price.id === prices.ACCELERATE_ANNUAL_USERS
      ) {
        usersQuantity = calculateQuantity;
      } else if (
        item.price.id === prices.ACCELERATE_TRACES_100K ||
        item.price.id === prices.LAUNCH_TRACES_10K ||
        item.price.id === prices.LAUNCH_ANNUAL_TRACES_10K ||
        item.price.id === prices.ACCELERATE_ANNUAL_TRACES_100K
      ) {
        tracesQuantity = calculateQuantity;
      }
    }

    const updatedSubscription = await prisma.subscription.update({
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
};

export const createStripeWebhookHandler = () => {
  const stripe = createStripeClient();

  return async function stripeWebhook(
    req: NextApiRequest,
    res: NextApiResponse,
  ) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).end("Method Not Allowed");
    }

    const sig = req.headers["stripe-signature"] as string | undefined;
    const secret = env.STRIPE_WEBHOOK_SECRET;
    if (!sig || !secret) {
      logger.error({ sig: !!sig, secret: !!secret }, "[stripeWebhook] Missing signature or secret");
      return res.status(400).send("Webhook Error: Missing signature or secret");
    }

    let event: Stripe.Event;

    try {
      const rawBody = await buffer(req);
      event = stripe.webhooks.constructEvent(rawBody, sig, secret);
    } catch (error) {
      logger.error({ error: (error as Error).message }, "[stripeWebhook] Failed to construct event");
      return res.status(400).send("Webhook Error: Invalid payload or signature");
    }

    try {
      if (
        event.type === "checkout.session.completed" ||
        event.type === "invoice.payment_succeeded" ||
        event.type === "invoice.payment_failed"
      ) {
        const paymentIntent = event.data.object as
          | Stripe.Checkout.Session
          | Stripe.Invoice;

        const customerId =
          typeof paymentIntent.customer === "string"
            ? paymentIntent.customer
            : paymentIntent.customer?.id;

        if (!customerId) {
          return res.json({ received: true });
        }

        const subscriptionId =
          typeof paymentIntent.subscription === "string"
            ? paymentIntent.subscription
            : paymentIntent.subscription?.id;

        if (!subscriptionId) {
          return res.json({ received: true });
        }

        const organization = await prisma.organization.findFirst({
          where: { stripeCustomerId: customerId },
        });

        if (!organization) {
          logger.error({ eventType: event.type, customerId: maskCustomerId(customerId) }, "[stripeWebhook] No organization found for customer");
          return res.json({ received: true });
        }

      switch (event.type) {
        case "checkout.session.completed": {
          const result = await handleCheckoutCompleted({ subscriptionId, event });
          if (result.earlyReturn) {
            logger.error({ customerId: maskCustomerId(customerId) }, "[stripeWebhook] No client_reference_id in checkout session");
            return res.json({ received: true });
          }
          break;
        }

        case "invoice.payment_succeeded": {
          await syncInvoicePaymentSuccess({ subscriptionId });
          break;
        }

        case "invoice.payment_failed": {
          await handleInvoicePaymentFailed({ subscriptionId });
          break;
        }
      }
      } else if (
        event.type === "customer.subscription.deleted" ||
        event.type === "customer.subscription.updated"
      ) {
        const subscription = event.data.object as Stripe.Subscription;
        if (!subscription.id) {
          return res.json({ received: true });
        }

        switch (event.type) {
          case "customer.subscription.deleted": {
            await handleSubscriptionDeleted({ subscription });
            break;
          }

          case "customer.subscription.updated": {
            await handleSubscriptionUpdated({ subscription });
            break;
          }
        }
      }

    } catch (error) {
      logger.error({ error: (error as Error).message, stack: (error as Error).stack, eventType: event.type }, "[stripeWebhook] Unhandled error processing event");
      return res.status(500).send("Webhook processing error");
    }

    return res.json({ received: true });
  };
};
