// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type Stripe from "stripe";

import { type StripeCustomer, StripeCustomersChannel } from "../stripe-customers.channel.ts";

/** Stripe's customers over billing's one client. */
export class HttpStripeCustomersChannel extends StripeCustomersChannel {
  private constructor(private readonly stripe: Stripe) {
    super();
  }

  static create(input: { stripe: Stripe }): HttpStripeCustomersChannel {
    return new HttpStripeCustomersChannel(input.stripe);
  }

  async createCustomer({ email, name }: { email: string; name: string }): Promise<{ id: string }> {
    const customer = await this.stripe.customers.create({ email, name });
    return { id: customer.id };
  }

  async deleteCustomer({ customerId }: { customerId: string }): Promise<void> {
    await this.stripe.customers.del(customerId);
  }

  async getCustomer({ customerId }: { customerId: string }): Promise<StripeCustomer> {
    const customer = await this.stripe.customers.retrieve(customerId);
    if (customer.deleted) return { id: customer.id, deleted: true };
    return { id: customer.id, deleted: false, currency: customer.currency ?? null };
  }
}
