import type { BillingDisplayInvoice } from "@langwatch/enterprise-billing-contract";
import type Stripe from "stripe";

import type { StripeInvoicesChannel } from "../channels/stripe-invoices.channel.ts";
import type { BillingAccountFactsRepository } from "../repositories/billing-account-facts.repository.ts";
import type { StripeErrorTranslator } from "./stripe-error-translator.service.ts";

export const RECENT_INVOICES_LIMIT = 4;

/** Lists an organisation's most recent non-draft Stripe invoices for display. */
export class BillingInvoicesService {
  private constructor(
    private readonly options: {
      organizationRepository: BillingAccountFactsRepository;
      stripeInvoices: StripeInvoicesChannel;
      stripeErrors: StripeErrorTranslator;
    },
  ) {}

  static create(options: {
    organizationRepository: BillingAccountFactsRepository;
    stripeInvoices: StripeInvoicesChannel;
    stripeErrors: StripeErrorTranslator;
  }): BillingInvoicesService {
    return new BillingInvoicesService(options);
  }

  async listInvoices({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<BillingDisplayInvoice[]> {
    const stripeCustomerId =
      await this.options.organizationRepository.findStripeCustomerId(organizationId);
    if (!stripeCustomerId) {
      return [];
    }

    let invoices: Stripe.Invoice[];
    try {
      invoices = await this.options.stripeInvoices.listInvoices({
        customerId: stripeCustomerId,
        limit: RECENT_INVOICES_LIMIT,
      });
    } catch (error) {
      throw this.options.stripeErrors.translate(error);
    }

    return invoices
      .filter((invoice) => invoice.status !== "draft")
      .map((invoice) => ({
        id: invoice.id,
        number: invoice.number ?? null,
        date: invoice.created,
        amountDue: invoice.amount_due,
        currency: invoice.currency,
        status: invoice.status ?? "unknown",
        pdfUrl: invoice.invoice_pdf ?? null,
        hostedUrl: invoice.hosted_invoice_url ?? null,
      }));
  }
}
