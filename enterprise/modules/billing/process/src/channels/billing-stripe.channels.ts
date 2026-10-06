// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ConnectedInvoicingChannel } from "./connected-invoicing.channel.ts";
import type { StripeCustomersChannel } from "./stripe-customers.channel.ts";
import type { StripeSubscriptionsChannel } from "./stripe-subscriptions.channel.ts";
import type { StripeWebhooksChannel } from "./stripe-webhooks.channel.ts";

/**
 * Billing's Stripe, one channel per subject over the one client billing builds
 * (Q69). Invoices and prices join as their services leave the raw SDK client.
 */
export interface BillingStripeChannels {
  readonly webhooks: StripeWebhooksChannel;
  readonly customers: StripeCustomersChannel;
  readonly subscriptions: StripeSubscriptionsChannel;
  readonly connectedInvoicing: ConnectedInvoicingChannel;
}
