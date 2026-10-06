// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ConnectedInvoicingChannel } from "./connected-invoicing.channel.ts";
import type { StripeWebhooksChannel } from "./stripe-webhooks.channel.ts";

/**
 * Billing's Stripe, one channel per subject over the one client billing builds
 * (Q69). Customers, subscriptions, invoices and prices join as their services
 * leave the raw SDK client.
 */
export interface BillingStripeChannels {
  readonly webhooks: StripeWebhooksChannel;
  readonly connectedInvoicing: ConnectedInvoicingChannel;
}
