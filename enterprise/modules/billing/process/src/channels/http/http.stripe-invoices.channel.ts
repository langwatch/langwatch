// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type Stripe from "stripe";

import type { BillingInvoice } from "../../rules/billing-stripe-shapes.rules.ts";
import {
  SEAT_INVOICE_SUBSCRIPTION_KEY,
  type SeatInvoicePurpose,
  seatInvoiceMetadata,
  readSeatInvoice,
} from "../../rules/seat-invoice.rules.ts";
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
    return detailOf(invoice);
  }

  async voidInvoice({ invoiceId }: { invoiceId: string }): Promise<void> {
    await this.stripe.invoices.voidInvoice(invoiceId);
  }

  async chargeSeatInvoice({
    customerId,
    purpose,
    amountCents,
    currency,
    description,
  }: {
    customerId: string;
    purpose: SeatInvoicePurpose;
    amountCents: number;
    currency: string;
    description: string;
  }): Promise<BillingInvoiceDetail> {
    const subscription = await this.stripe.subscriptions.retrieve(purpose.subscriptionId);
    const method = subscription.default_payment_method;
    const metadata = seatInvoiceMetadata(purpose);
    // auto_advance off: Stripe neither charges it later nor retries it; billing pays it now.
    const draft = await this.stripe.invoices.create({
      customer: customerId,
      currency,
      collection_method: "charge_automatically",
      auto_advance: false,
      pending_invoice_items_behavior: "exclude",
      automatic_tax: { enabled: subscription.automatic_tax?.enabled ?? false },
      description,
      metadata,
      ...(method
        ? { default_payment_method: typeof method === "string" ? method : method.id }
        : {}),
    });
    await this.stripe.invoiceItems.create({
      customer: customerId,
      invoice: draft.id,
      amount: amountCents,
      currency,
      description,
      metadata,
    });
    const finalized = await this.stripe.invoices.finalizeInvoice(draft.id, { auto_advance: false });
    if (finalized.status !== "open") return this.getInvoice({ invoiceId: draft.id });
    try {
      await this.stripe.invoices.pay(draft.id);
    } catch (error) {
      if (!isCardRefusal(error)) throw error;
    }
    return this.getInvoice({ invoiceId: draft.id });
  }

  async findOpenSeatInvoices({
    customerId,
    subscriptionId,
  }: {
    customerId: string;
    subscriptionId: string;
  }): Promise<BillingInvoiceDetail[]> {
    // A listing, not a search: search lags writes, and a second click comes seconds later.
    const page = await this.stripe.invoices.list({
      customer: customerId,
      status: "open",
      limit: 20,
    });
    return page.data
      .filter((invoice) => invoice.metadata?.[SEAT_INVOICE_SUBSCRIPTION_KEY] === subscriptionId)
      .map(detailOf);
  }
}

/** A decline or a payment waiting on the customer: the invoice stays open for them to pay. */
function isCardRefusal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    (error as { type: unknown }).type === "StripeCardError"
  );
}

function detailOf(invoice: Stripe.Invoice): BillingInvoiceDetail {
  const seat = readSeatInvoice(invoice.metadata);
  return {
    ...invoiceOf(invoice),
    card: cardOf(invoice),
    seatPurchase: seat.seatInvoice ? seat.purpose : null,
  };
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
