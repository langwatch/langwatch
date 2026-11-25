// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ConnectedInvoicingChannel } from "./connected-invoicing.channel.ts";
import type { StripeCustomersChannel } from "./stripe-customers.channel.ts";
import type { StripeInvoicesChannel } from "./stripe-invoices.channel.ts";
import type { StripeMetersChannel } from "./stripe-meters.channel.ts";
import type { StripePricesChannel } from "./stripe-prices.channel.ts";
import type { StripeSubscriptionsChannel } from "./stripe-subscriptions.channel.ts";
import type { StripeWebhooksChannel } from "./stripe-webhooks.channel.ts";

/**
 * Billing's Stripe, one channel per subject over the one client billing builds
 * (Q69); meters are the sixth subject (Q69-4), connected invoicing stays one channel.
 */
export interface BillingStripeChannels {
  readonly webhooks: StripeWebhooksChannel;
  readonly customers: StripeCustomersChannel;
  readonly subscriptions: StripeSubscriptionsChannel;
  readonly invoices: StripeInvoicesChannel;
  readonly prices: StripePricesChannel;
  readonly meters: StripeMetersChannel;
  readonly connectedInvoicing: ConnectedInvoicingChannel;
}
