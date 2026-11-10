// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BillingInvoice } from "../../rules/billing-stripe-shapes.rules.ts";
import { StripeInvoicesChannel, type BillingInvoiceDetail } from "../stripe-invoices.channel.ts";

type Operation = keyof StripeInvoicesChannel;

/**
 * Stripe's invoices where no provider is composed: keeps what a test seeds and
 * every listing asked for, and answers a customer's newest first, as Stripe does.
 */
export class MemoryStripeInvoicesChannel extends StripeInvoicesChannel {
  readonly listings: { customerId: string; limit: number }[] = [];
  private readonly held: BillingInvoiceDetail[] = [];
  private readonly refusals = new Map<Operation, Error>();

  private constructor() {
    super();
  }

  static create(): MemoryStripeInvoicesChannel {
    return new MemoryStripeInvoicesChannel();
  }

  /** Puts an invoice at the provider, under the customer it names. */
  seed({
    invoice,
    card = null,
  }: {
    invoice: BillingInvoice;
    card?: BillingInvoiceDetail["card"];
  }): void {
    this.held.push({ ...invoice, card });
  }

  /** Moves a seeded invoice to `status`, as a payment or staff action at the provider would. */
  settle({ invoiceId, status }: { invoiceId: string; status: BillingInvoice["status"] }): void {
    const index = this.held.findIndex((each) => each.id === invoiceId);
    const invoice = this.held[index];
    if (!invoice) throw new Error(`No such invoice: ${invoiceId}`);
    this.held[index] = { ...invoice, status };
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
  }): Promise<BillingInvoice[]> {
    const refusal = this.refusals.get("listInvoices");
    if (refusal) throw refusal;
    this.listings.push({ customerId, limit });
    return this.held
      .filter((invoice) => invoice.customerId === customerId)
      .toSorted((a, b) => b.created - a.created)
      .slice(0, limit)
      .map(({ card: _card, ...invoice }) => invoice);
  }

  async getInvoice({ invoiceId }: { invoiceId: string }): Promise<BillingInvoiceDetail> {
    const refusal = this.refusals.get("getInvoice");
    if (refusal) throw refusal;
    const invoice = this.held.find((each) => each.id === invoiceId);
    if (!invoice) throw new Error(`No such invoice: ${invoiceId}`);
    return invoice;
  }
}
