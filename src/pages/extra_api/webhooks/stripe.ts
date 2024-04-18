import Stripe from "stripe";
import { prisma } from "../../../../langwatch/langwatch/src/server/db";
import type { NextApiRequest, NextApiResponse } from "next";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).end("Method Not Allowed");
  }

  let event;
  const sig = req.headers["stripe-signature"] as string;

  try {
    // Verify and parse the event
    event = stripe.webhooks.constructEvent(
      //@ts-ignore
      req.rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.log(`⚠️  Webhook signature verification failed.`);
    return res.status(400).send(`Webhook Error: ${(err as any)?.message}`);
  }

  console.log(`🔔  Webhook received: ${event.type}`);

  if (
    event.type === "checkout.session.completed" ||
    event.type === "invoice.payment_succeeded" ||
    event.type === "invoice.payment_failed"
  ) {
    const paymentIntent = event.data.object;
    const customerId =
      typeof paymentIntent.customer === "string"
        ? paymentIntent.customer
        : paymentIntent.customer?.id;
    if (!customerId) {
      console.log("Customer ID not found in payment intent.");
      return res.json({ received: true });
    }
    const subscriptionId =
      typeof paymentIntent.subscription === "string"
        ? paymentIntent.subscription
        : paymentIntent.subscription?.id;
    if (!subscriptionId) {
      console.log("Subscription ID not found in payment intent.");
      return res.json({ received: true });
    }

    const organization = await prisma.organization.findFirst({
      where: { stripeCustomerId: customerId },
    });
    if (!organization) {
      console.log("Organization not found for customer ID.");
      return res.json({ received: true });
    }

    // Handle the event
    switch (event.type) {
      case "checkout.session.completed":
        const subscriptionClientReferenceId =
          event.data.object.client_reference_id?.replace(
            "subscription_setup_",
            ""
          );
        if (!subscriptionClientReferenceId) {
          console.log("Subscription client reference ID not found in session.");
          return res.json({ received: true });
        }

        await prisma.subscription.update({
          where: {
            id: subscriptionClientReferenceId,
          },
          data: { stripeSubscriptionId: subscriptionId },
        });

      case "invoice.payment_succeeded":
        await new Promise((resolve) => setTimeout(resolve, 2000)); // wait for Stripe to update the subscription id
        await prisma.subscription.update({
          where: { stripeSubscriptionId: subscriptionId },
          data: {
            status: "ACTIVE",
            startDate: new Date(),
            lastPaymentFailedDate: null,
          },
        });
        break;

      case "invoice.payment_failed":
        await new Promise((resolve) => setTimeout(resolve, 2000)); // wait for Stripe to update the subscription id
        const currentSubscription = await prisma.subscription.findFirst({
          where: { stripeSubscriptionId: subscriptionId },
        });

        await prisma.subscription.update({
          where: { stripeSubscriptionId: subscriptionId },
          data: {
            status:
              currentSubscription?.status === "ACTIVE"
                ? "ACTIVE" // do not kill the subscription if payment failed, keep for a few more days until we consider past due
                : "FAILED",
            lastPaymentFailedDate: new Date(),
          },
        });
        break;
    }
  } else if (
    event.type === "customer.subscription.deleted" ||
    event.type === "customer.subscription.updated"
  ) {
    const subscription = event.data.object;
    if (!subscription.id) {
      console.log("Subscription ID not found in payment intent.");
      return res.json({ received: true });
    }

    switch (event.type) {
      case "customer.subscription.deleted":
        await prisma.subscription.update({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            status: "CANCELLED",
            endDate: new Date(),
          },
        });
        break;
      case "customer.subscription.updated":
        await new Promise((resolve) => setTimeout(resolve, 2000)); // wait for Stripe to update the subscription id
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
            },
          });
        } else if (subscription.status === "active") {
          await prisma.subscription.update({
            where: { stripeSubscriptionId: subscription.id },
            data: {
              status: "ACTIVE",
              lastPaymentFailedDate: null,
            },
          });
        }
        break;
    }
  } else {
    console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
}
