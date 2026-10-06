// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type Stripe from "stripe";

import { StripeInvoicesChannel } from "../stripe-invoices.channel.ts";

type Operation = keyof StripeInvoicesChannel;

/**
 * Stripe's invoices where no provider is composed: keeps what a test seeds and
 * every listing asked for, and answers a customer's newest first, as Stripe does.
 */
export class MemoryStripeInvoicesChannel extends StripeInvoicesChannel {
  readonly listings: { customerId: string; limit: number }[] = [];
  private readonly held: Stripe.Invoice[] = [];
  private readonly refusals = new Map<Operation, Error>();

  private constructor() {
    super();
  }

  static create(): MemoryStripeInvoicesChannel {
    return new MemoryStripeInvoicesChannel();
  }

  /** Puts an invoice at the provider, under the customer it names. */
  seed({ invoice }: { invoice: Stripe.Invoice }): void {
    this.held.push(invoice);
  }

  /** Makes `operation` throw `error` from now on, as a failing provider would. */
  refuse({ operation, error }: { operation: Operation; error: Error }): void {
    this.refusals.set(operation, error);
  }

  async listInvoices({
    customerId,
    limit,
  }: {
    customerId: string;
    limit: number;
  }): Promise<Stripe.Invoice[]> {
    const refusal = this.refusals.get("listInvoices");
    if (refusal) throw refusal;
    this.listings.push({ customerId, limit });
    return this.held
      .filter((invoice) => isIssuedTo({ invoice, customerId }))
      .toSorted((a, b) => b.created - a.created)
      .slice(0, limit);
  }
}

function isIssuedTo({
  invoice,
  customerId,
}: {
  invoice: Stripe.Invoice;
  customerId: string;
}): boolean {
  const { customer } = invoice;
  if (customer === null || typeof customer === "string") return customer === customerId;
  return customer.id === customerId;
}
