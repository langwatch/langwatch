// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { nowInstant } from "@langwatch/time";

import type { BillingInvoice } from "../../rules/billing-stripe-shapes.rules.ts";
import type { SeatInvoicePurpose } from "../../rules/seat-invoice.rules.ts";
import { StripeInvoicesChannel, type BillingInvoiceDetail } from "../stripe-invoices.channel.ts";

/** How the next seat invoice's charge ends: paid, or left open with or without a payment page. */
type SeatChargeOutcome = Readonly<{ status: "paid" | "open"; hostedUrl: string | null }>;

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
    seatPurchase = null,
  }: {
    invoice: BillingInvoice;
    card?: BillingInvoiceDetail["card"];
    seatPurchase?: SeatInvoicePurpose | null;
  }): void {
    this.held.push({ ...invoice, card, seatPurchase });
  }

  /** The seat invoices billed, in order. */
  readonly seatCharges: { customerId: string; purpose: SeatInvoicePurpose; amountCents: number }[] =
    [];
  private nextSeatCharge: SeatChargeOutcome = { status: "paid", hostedUrl: null };

  /** Makes the next seat invoice end as `outcome`, as a declined or 3-D Secure card would. */
  chargeNextSeatInvoice(outcome: SeatChargeOutcome): void {
    this.nextSeatCharge = outcome;
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
      .map(({ card: _card, seatPurchase: _seatPurchase, ...invoice }) => invoice);
  }

  async getInvoice({ invoiceId }: { invoiceId: string }): Promise<BillingInvoiceDetail> {
    const refusal = this.refusals.get("getInvoice");
    if (refusal) throw refusal;
    const invoice = this.held.find((each) => each.id === invoiceId);
    if (!invoice) throw new Error(`No such invoice: ${invoiceId}`);
    return invoice;
  }

  async chargeSeatInvoice({
    customerId,
    purpose,
    amountCents,
    currency,
  }: {
    customerId: string;
    purpose: SeatInvoicePurpose;
    amountCents: number;
    currency: string;
    description: string;
  }): Promise<BillingInvoiceDetail> {
    const refusal = this.refusals.get("chargeSeatInvoice");
    if (refusal) throw refusal;
    this.seatCharges.push({ customerId, purpose, amountCents });
    const { status, hostedUrl } = this.nextSeatCharge;
    this.nextSeatCharge = { status: "paid", hostedUrl: null };
    const invoice: BillingInvoiceDetail = {
      id: `in_seat_${this.seatCharges.length}`,
      customerId,
      number: null,
      created: Math.floor(nowInstant().epochMilliseconds / 1000),
      amountDue: amountCents,
      currency,
      status,
      pdfUrl: null,
      hostedUrl,
      card: null,
      seatPurchase: purpose,
    };
    this.held.push(invoice);
    return invoice;
  }

  async findOpenSeatInvoices({
    customerId,
    subscriptionId,
  }: {
    customerId: string;
    subscriptionId: string;
  }): Promise<BillingInvoiceDetail[]> {
    return this.held
      .filter(
        (invoice) =>
          invoice.customerId === customerId &&
          invoice.status === "open" &&
          invoice.seatPurchase?.subscriptionId === subscriptionId,
      )
      .toSorted((a, b) => b.created - a.created);
  }

  /** The invoices voided, in order. */
  readonly voided: string[] = [];

  async voidInvoice({ invoiceId }: { invoiceId: string }): Promise<void> {
    const refusal = this.refusals.get("voidInvoice");
    if (refusal) throw refusal;
    this.voided.push(invoiceId);
    const index = this.held.findIndex((each) => each.id === invoiceId);
    const invoice = this.held[index];
    if (invoice) this.held[index] = { ...invoice, status: "void" };
  }
}
