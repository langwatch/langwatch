// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The invoices subject of billing's Stripe channels (Q69): a customer's issued
 * invoices, in Stripe's own shape as the subscriptions subject answers its own.
 */

import type Stripe from "stripe";

export abstract class StripeInvoicesChannel {
  /** The customer's newest invoices first, at most `limit` of them; drafts included. */
  abstract listInvoices(input: { customerId: string; limit: number }): Promise<Stripe.Invoice[]>;
}
