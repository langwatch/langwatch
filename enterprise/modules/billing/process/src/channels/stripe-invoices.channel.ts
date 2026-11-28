// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The invoices subject of billing's Stripe channels (Q69): a customer's issued
 * invoices, in billing's own shape; the http tier maps the SDK's.
 */

import type { BillingInvoice } from "../rules/billing-stripe-shapes.rules.ts";
import type { SeatInvoicePurpose } from "../rules/seat-invoice.rules.ts";

/** One invoice, the card its last charge tried when Stripe names one, and the seats it buys. */
export type BillingInvoiceDetail = BillingInvoice &
  Readonly<{
    card: Readonly<{ brand: string; last4: string }> | null;
    seatPurchase: SeatInvoicePurpose | null;
  }>;

export abstract class StripeInvoicesChannel {
  /** The customer's newest invoices first, at most `limit` of them; drafts included. */
  abstract listInvoices(input: { customerId: string; limit: number }): Promise<BillingInvoice[]>;

  /** One invoice by id; throws when Stripe cannot answer it. */
  abstract getInvoice(input: { invoiceId: string }): Promise<BillingInvoiceDetail>;

  /** Voids an open invoice, dropping the subscription change it holds; throws when refused. */
  abstract voidInvoice(input: { invoiceId: string }): Promise<void>;

  /**
   * Bills `amountCents` (before tax) for a seat purchase on an invoice of its own, with none of
   * the customer's pending items, and tries the subscription's card at once. Answers it paid, or
   * open when the card was declined or needs the customer to act.
   */
  abstract chargeSeatInvoice(input: {
    customerId: string;
    purpose: SeatInvoicePurpose;
    amountCents: number;
    currency: string;
    description: string;
  }): Promise<BillingInvoiceDetail>;

  /** The customer's open seat invoices for the subscription, newest first. */
  abstract findOpenSeatInvoices(input: {
    customerId: string;
    subscriptionId: string;
  }): Promise<BillingInvoiceDetail[]>;
}
