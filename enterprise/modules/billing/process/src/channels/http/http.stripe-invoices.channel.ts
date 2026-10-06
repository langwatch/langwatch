// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type Stripe from "stripe";

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
  }): Promise<Stripe.Invoice[]> {
    const page = await this.stripe.invoices.list({ customer: customerId, limit });
    return page.data;
  }
}
