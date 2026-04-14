import { buffer } from "micro";
import type { NextApiRequest, NextApiResponse } from "~/types/next-stubs";
import type Stripe from "stripe";
import { Currency } from "@prisma/client";
import { env } from "../../src/env.mjs";
import { prisma } from "../../src/server/db";
import { createLogger } from "../../src/utils/logger";
import type { WebhookService } from "./services/webhookService";
import { handleLicensePurchase } from "./services/licensePurchaseHandler";
import { getPostHogInstance } from "../../src/server/posthog";

const VALID_CURRENCIES = new Set<string>(Object.values(Currency));

const logger = createLogger("langwatch:billing:stripeWebhook");

const maskCustomerId = (id: string) => `${id.slice(0, 7)}...${id.slice(-4)}`;

export const createStripeWebhookHandlerFactory = ({
  stripe,
  webhookService,
}: {
  stripe: Stripe;
  webhookService: WebhookService;
}) => {
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
      logger.error(
        { sig: !!sig, secret: !!secret },
        "[stripeWebhook] Missing signature or secret",
      );
      return res.status(400).send("Webhook Error: Missing signature or secret");
    }

    let event: Stripe.Event;

    try {
      const rawBody = await buffer(req);
      event = stripe.webhooks.constructEvent(rawBody, sig, secret);
    } catch (error) {
      logger.error(
        { error: (error as Error).message },
        "[stripeWebhook] Failed to construct event",
      );
      return res
        .status(400)
        .send("Webhook Error: Invalid payload or signature");
    }

    try {
      // License purchase routing — must happen before subscription flow
      // because self-hosted buyers have no organization in the SaaS database
      if (event.type === "checkout.session.completed") {
        const checkoutSession = event.data
          .object as Stripe.Checkout.Session;
        const paymentLinkId =
          typeof checkoutSession.payment_link === "string"
            ? checkoutSession.payment_link
            : checkoutSession.payment_link?.id;

        if (
          env.STRIPE_LICENSE_PAYMENT_LINK_ID &&
          paymentLinkId === env.STRIPE_LICENSE_PAYMENT_LINK_ID
        ) {
          const privateKey = env.LANGWATCH_LICENSE_PRIVATE_KEY;
          if (!privateKey) {
            logger.error(
              "[stripeWebhook] LANGWATCH_LICENSE_PRIVATE_KEY is not configured",
            );
            return res
              .status(500)
              .send("License generation error: missing private key");
          }

          await handleLicensePurchase({
            checkoutSession,
            stripe,
            privateKey,
          });

          return res.json({ received: true });
        }
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
          logger.error(
            {
              eventType: event.type,
              customerId: maskCustomerId(customerId),
            },
            "[stripeWebhook] No organization found for customer",
          );
          return res.json({ received: true });
        }

        switch (event.type) {
          case "checkout.session.completed": {
            const checkoutSession = event.data.object as Stripe.Checkout.Session;
            const clientReferenceId = checkoutSession.client_reference_id;
            const selectedCurrencyRaw = checkoutSession.metadata?.selectedCurrency;
            const selectedCurrency = selectedCurrencyRaw && VALID_CURRENCIES.has(selectedCurrencyRaw)
              ? selectedCurrencyRaw
              : null;
            const result = await webhookService.handleCheckoutCompleted({
              subscriptionId,
              clientReferenceId: clientReferenceId ?? null,
              selectedCurrency,
            });
            if (result.earlyReturn) {
              logger.error(
                { customerId: maskCustomerId(customerId) },
                "[stripeWebhook] No client_reference_id in checkout session",
              );
              return res.json({ received: true });
            }

            const posthogServer = getPostHogInstance();
            if (posthogServer) {
              posthogServer.capture({
                distinctId: organization.id,
                event: "subscription_created",
                properties: {
                  subscriptionId,
                  $groups: { organization: organization.id },
                },
              });
              posthogServer.groupIdentify({
                groupType: "organization",
                groupKey: organization.id,
                properties: {
                  subscriptionCreatedAt: new Date(
                    checkoutSession.created * 1000,
                  ).toISOString(),
                  hasActiveSubscription: true,
                },
              });
            }
            break;
          }

          case "invoice.payment_succeeded": {
            await webhookService.handleInvoicePaymentSucceeded({
              subscriptionId,
            });
            break;
          }

          case "invoice.payment_failed": {
            await webhookService.handleInvoicePaymentFailed({
              subscriptionId,
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
            await webhookService.handleSubscriptionDeleted({
              stripeSubscriptionId: subscription.id,
            });
            break;
          }

          case "customer.subscription.updated": {
            await webhookService.handleSubscriptionUpdated({
              subscription,
            });
            break;
          }
        }
      }
    } catch (error) {
      logger.error(
        {
          error: (error as Error).message,
          stack: (error as Error).stack,
          eventType: event.type,
        },
        "[stripeWebhook] Unhandled error processing event",
      );
      return res.status(500).send("Webhook processing error");
    }

    return res.json({ received: true });
  };
};
