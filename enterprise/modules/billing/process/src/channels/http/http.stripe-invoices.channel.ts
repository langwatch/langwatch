// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type Stripe from "stripe";

import type { BillingInvoice } from "../../rules/billing-stripe-shapes.rules.ts";
import { StripeInvoicesChannel } from "../stripe-invoices.channel.ts";

/** Stripe's invoices over billing's one client. */
export class HttpStripeInvoicesChannel extends StripeInvoicesChannel {
  private constructor(private readonly stripe: Stripe) {
    super();
  }

  static create(input: { stripe: Stripe }): HttpStripeInvoicesChannel {
    return new HttpStripeInvoicesChannel(input.stripe);
  }

  async listInvoices({
    customerId,
    limit,
  }: {
    customerId: string;
    limit: number;
  }): Promise<BillingInvoice[]> {
    const page = await this.stripe.invoices.list({ customer: customerId, limit });
    return page.data.map(invoiceOf);
  }
}

function invoiceOf(invoice: Stripe.Invoice): BillingInvoice {
  const { customer } = invoice;
  return {
    id: invoice.id,
    customerId: typeof customer === "string" ? customer : (customer?.id ?? null),
    number: invoice.number ?? null,
    created: invoice.created,
    amountDue: invoice.amount_due,
    currency: invoice.currency,
    status: invoice.status ?? null,
    pdfUrl: invoice.invoice_pdf ?? null,
    hostedUrl: invoice.hosted_invoice_url ?? null,
  };
}
