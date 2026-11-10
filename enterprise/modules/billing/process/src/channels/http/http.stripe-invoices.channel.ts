// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type Stripe from "stripe";

import type { BillingInvoice } from "../../rules/billing-stripe-shapes.rules.ts";
import { StripeInvoicesChannel, type BillingInvoiceDetail } from "../stripe-invoices.channel.ts";

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

  async getInvoice({ invoiceId }: { invoiceId: string }): Promise<BillingInvoiceDetail> {
    const invoice = await this.stripe.invoices.retrieve(invoiceId, {
      expand: ["payment_intent.payment_method", "payment_intent.last_payment_error.payment_method"],
    });
    return { ...invoiceOf(invoice), card: cardOf(invoice) };
  }
}

/** The card the invoice's payment tried: the attached method, else the one its last error names. */
function cardOf(invoice: Stripe.Invoice): BillingInvoiceDetail["card"] {
  const intent = typeof invoice.payment_intent === "object" ? invoice.payment_intent : null;
  const candidates = [intent?.payment_method, intent?.last_payment_error?.payment_method];
  for (const method of candidates) {
    if (method && typeof method === "object" && method.card) {
      return { brand: brandName(method.card.brand), last4: method.card.last4 };
    }
  }
  return null;
}

const BRAND_NAMES: Record<string, string> = {
  amex: "American Express",
  diners: "Diners Club",
  discover: "Discover",
  jcb: "JCB",
  mastercard: "Mastercard",
  unionpay: "UnionPay",
  visa: "Visa",
};

function brandName(brand: string): string {
  return BRAND_NAMES[brand] ?? "card";
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
