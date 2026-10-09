// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  BillingPriceCatalogue,
  getStripeEnvironmentFromNodeEnv,
} from "@langwatch/enterprise-billing-contract";
import Stripe from "stripe";

import type { BillingStripeChannels } from "../billing-stripe.channels.ts";
import { connectedInvoicingChannels } from "../connected-invoicing-channels.registry.ts";
import { stripeCustomersChannels } from "../stripe-customers-channels.registry.ts";
import { stripeInvoicesChannels } from "../stripe-invoices-channels.registry.ts";
import { stripeMetersChannels } from "../stripe-meters-channels.registry.ts";
import { stripePricesChannels } from "../stripe-prices-channels.registry.ts";
import { stripeSubscriptionsChannels } from "../stripe-subscriptions-channels.registry.ts";

/** Stripe API version billing's one client speaks; meter event shapes are frozen to it. */
const STRIPE_API_VERSION = "2024-04-10";

/** Every subject the webhook signing secret does not open. */
type HttpBillingStripeSubjects = Omit<BillingStripeChannels, "webhooks">;

/**
 * Billing's one Stripe client, built here and nowhere else (Q69-4), and every
 * subject channel over it. The SDK's defaults (one network retry, telemetry)
 * are the policy usage reporting froze.
 */
export function composeHttpBillingStripe({
  secretKey,
  nodeEnvironment,
}: {
  secretKey: string;
  nodeEnvironment: string | undefined;
}): HttpBillingStripeSubjects {
  const stripe = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
  return {
    customers: stripeCustomersChannels.http.create({ stripe }),
    subscriptions: stripeSubscriptionsChannels.http.create({ stripe }),
    invoices: stripeInvoicesChannels.http.create({ stripe }),
    prices: stripePricesChannels.http.create({ stripe }),
    meters: stripeMetersChannels.http.create({ stripe }),
    connectedInvoicing: connectedInvoicingChannels.http.create({
      stripe,
      usagePriceId: () =>
        BillingPriceCatalogue.create(getStripeEnvironmentFromNodeEnv(nodeEnvironment)).prices
          .CONNECTED_HOSTED_USAGE_QUARTERLY,
    }),
  };
}
