import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { prisma } from "../../src/server/db";
import {
  calculateQuantityForPrice,
  prices,
} from "./stripeHelpers";
import { sendSubscriptionSlackNotification } from "./subscriptionSlackService";

const createStripeClient = () => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is required for SaaS billing runtime");
  }

  return new Stripe(secretKey, {
    apiVersion: "2024-04-10",
  });
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
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!sig || !secret) {
      return res.status(400).send("Webhook Error: Missing signature or secret");
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        // @ts-expect-error rawBody is attached by the route layer
        req.rawBody,
        sig,
        secret,
      );
    } catch (error) {
      return res.status(400).send(`Webhook Error: ${(error as Error).message}`);
    }

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
        return res.json({ received: true });
      }

      switch (event.type) {
        case "checkout.session.completed": {
          const subscriptionClientReferenceId =
            (event.data.object as Stripe.Checkout.Session).client_reference_id?.replace(
              "subscription_setup_",
              "",
            );

          if (!subscriptionClientReferenceId) {
            return res.json({ received: true });
          }

          await prisma.subscription.update({
            where: {
              id: subscriptionClientReferenceId,
            },
            data: { stripeSubscriptionId: subscriptionId },
          });
        }
        // fallthrough is intentional because checkout success is followed by invoice status sync.
        case "invoice.payment_succeeded": {
          await new Promise((resolve) => setTimeout(resolve, 2000));

          const previousSubscription = await prisma.subscription.findFirst({
            where: { stripeSubscriptionId: subscriptionId },
            select: { status: true },
          });

          const updatedSubscription = await prisma.subscription.update({
            where: { stripeSubscriptionId: subscriptionId },
            data: {
              status: "ACTIVE",
              startDate: new Date(),
              lastPaymentFailedDate: null,
            },
            include: { organization: true },
          });

          if (previousSubscription?.status !== "ACTIVE") {
            await sendSubscriptionSlackNotification({
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

          break;
        }

        case "invoice.payment_failed": {
          await new Promise((resolve) => setTimeout(resolve, 2000));

          const currentSubscription = await prisma.subscription.findFirst({
            where: { stripeSubscriptionId: subscriptionId },
          });

          await prisma.subscription.update({
            where: { stripeSubscriptionId: subscriptionId },
            data: {
              status:
                currentSubscription?.status === "ACTIVE" ? "ACTIVE" : "FAILED",
              lastPaymentFailedDate: new Date(),
            },
          });
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
          await prisma.subscription.update({
            where: { stripeSubscriptionId: subscription.id },
            data: {
              status: "CANCELLED",
              endDate: new Date(),
              maxMembers: null,
              maxMessagesPerMonth: null,
            },
          });
          break;
        }

        case "customer.subscription.updated": {
          await new Promise((resolve) => setTimeout(resolve, 2000));

          let tracesQuantity: number | null = null;
          let usersQuantity: number | null = null;

          if (
            subscription.status !== "active" ||
            subscription.canceled_at ||
            subscription.ended_at
          ) {
            await prisma.subscription.update({
              where: { stripeSubscriptionId: subscription.id },
              data: {
                status: "CANCELLED",
                endDate: new Date(),
                maxMembers: null,
                maxMessagesPerMonth: null,
              },
            });
          } else if (subscription.status === "active") {
            const currentSubscription = await prisma.subscription.findFirst({
              where: { stripeSubscriptionId: subscription.id },
            });

            const shouldNotify = currentSubscription?.status !== "ACTIVE";

            for (const item of subscription.items.data) {
              const calculateQuantity = calculateQuantityForPrice(
                item.price.id,
                item.quantity ?? 0,
                currentSubscription?.plan,
              );

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
              where: { stripeSubscriptionId: subscription.id },
              data: {
                status: "ACTIVE",
                lastPaymentFailedDate: null,
                maxMembers: usersQuantity,
                maxMessagesPerMonth: tracesQuantity,
              },
              include: { organization: true },
            });

            if (shouldNotify) {
              await sendSubscriptionSlackNotification({
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
          break;
        }
      }
    }

    return res.json({ received: true });
  };
};
