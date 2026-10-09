// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  BillingPriceCatalogue,
  getStripeEnvironmentFromNodeEnv,
} from "@langwatch/enterprise-billing-contract";
import Stripe from "stripe";

import type { BillingStripeChannels } from "../billing-stripe.channels.ts";
import { HttpConnectedInvoicingChannel } from "./http.connected-invoicing.channel.ts";
import { HttpStripeCustomersChannel } from "./http.stripe-customers.channel.ts";
import { HttpStripeInvoicesChannel } from "./http.stripe-invoices.channel.ts";
import { HttpStripeMetersChannel } from "./http.stripe-meters.channel.ts";
import { HttpStripePricesChannel } from "./http.stripe-prices.channel.ts";
import { HttpStripeSubscriptionsChannel } from "./http.stripe-subscriptions.channel.ts";

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
    customers: HttpStripeCustomersChannel.create({ stripe }),
    subscriptions: HttpStripeSubscriptionsChannel.create({ stripe }),
    invoices: HttpStripeInvoicesChannel.create({ stripe }),
    prices: HttpStripePricesChannel.create({ stripe }),
    meters: HttpStripeMetersChannel.create({ stripe }),
    connectedInvoicing: HttpConnectedInvoicingChannel.create({
      stripe,
      usagePriceId: () =>
        BillingPriceCatalogue.create(getStripeEnvironmentFromNodeEnv(nodeEnvironment)).prices
          .CONNECTED_HOSTED_USAGE_QUARTERLY,
    }),
  };
}
