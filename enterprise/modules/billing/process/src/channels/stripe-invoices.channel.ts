// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The invoices subject of billing's Stripe channels (Q69): a customer's issued
 * invoices, in billing's own shape; the http tier maps the SDK's.
 */

import type { BillingInvoice } from "../rules/billing-stripe-shapes.rules.ts";

export abstract class StripeInvoicesChannel {
  /** The customer's newest invoices first, at most `limit` of them; drafts included. */
  abstract listInvoices(input: { customerId: string; limit: number }): Promise<BillingInvoice[]>;
}
