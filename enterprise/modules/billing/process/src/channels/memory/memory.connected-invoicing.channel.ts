// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type ConnectedInvoicingChannel as ChannelShape,
  ConnectedInvoicingChannel,
  type ProviderInvoice,
} from "../connected-invoicing.channel.ts";

type CreateCustomerInput = Parameters<ChannelShape["createCustomer"]>[0];
type CreateSubscriptionInput = Parameters<ChannelShape["createUsageSubscription"]>[0];
type CreateGrantInput = Parameters<ChannelShape["createCreditGrant"]>[0];
type CreateInput = Parameters<ChannelShape["createOneOffInvoice"]>[0];
type FinalizedUsageInput = Parameters<ChannelShape["hasFinalizedUsageInvoice"]>[0];

/**
 * Mints an invoice id locally and keeps what it was asked for, where no
 * payment provider is composed. It keeps the provider's idempotency: the same
 * customer and metadata answer with the same invoice, which is what a retry
 * relies on.
 */
export class MemoryConnectedInvoicingChannel extends ConnectedInvoicingChannel {
  readonly raised: CreateInput[] = [];
  readonly customers: CreateCustomerInput[] = [];
  readonly subscriptions: CreateSubscriptionInput[] = [];
  readonly grants: CreateGrantInput[] = [];
  readonly paidOutOfBand: string[] = [];
  /** Period ends a usage invoice has closed over, as a test declares them. */
  readonly finalizedUsagePeriodEndsMs = new Set<number>();
  private readonly byKey = new Map<string, ProviderInvoice>();
  private readonly byId = new Map<string, ProviderInvoice>();

  private constructor() {
    super();
  }

  static create(): MemoryConnectedInvoicingChannel {
    return new MemoryConnectedInvoicingChannel();
  }

  async createCustomer(input: CreateCustomerInput): Promise<{ id: string }> {
    const existing = this.customers.find(
      (customer) => customer.organizationId === input.organizationId,
    );
    if (existing) return { id: customerIdOf(existing.organizationId) };

    this.customers.push(input);

    return { id: customerIdOf(input.organizationId) };
  }

  async createUsageSubscription(
    input: CreateSubscriptionInput,
  ): Promise<{ id: string; itemId: string }> {
    this.subscriptions.push(input);
    const ordinal = this.subscriptions.length;

    return { id: `sub_memory_${ordinal}`, itemId: `si_memory_${ordinal}` };
  }

  async createCreditGrant(input: CreateGrantInput): Promise<{ id: string }> {
    const key = `${input.customerId}:${metadataKey(input.metadata)}`;
    const already = this.grants.findIndex(
      (grant) => `${grant.customerId}:${metadataKey(grant.metadata)}` === key,
    );
    if (already >= 0) return { id: `credgr_memory_${already + 1}` };

    this.grants.push(input);

    return { id: `credgr_memory_${this.grants.length}` };
  }

  async createOneOffInvoice(input: CreateInput): Promise<ProviderInvoice> {
    const key = `${input.customerId}:${metadataKey(input.metadata)}`;
    const existing = this.byKey.get(key);
    if (existing) return existing;

    this.raised.push(input);
    const invoice: ProviderInvoice = {
      id: `in_memory_${this.byKey.size + 1}`,
      status: "open",
      currency: input.currency.toLowerCase(),
      amountDueCents: input.lines.reduce((total, line) => total + line.amountCents, 0),
      subscriptionId: null,
      periodEndMs: null,
    };
    this.byKey.set(key, invoice);
    this.byId.set(invoice.id, invoice);

    return invoice;
  }

  async getInvoice(stripeInvoiceId: string): Promise<ProviderInvoice> {
    const invoice = this.byId.get(stripeInvoiceId);
    if (!invoice) throw new Error(`no invoice ${stripeInvoiceId} was raised here`);

    return invoice;
  }

  async hasFinalizedUsageInvoice(input: FinalizedUsageInput): Promise<boolean> {
    return [...this.finalizedUsagePeriodEndsMs].some(
      (periodEndMs) => periodEndMs >= input.periodEnd.epochMilliseconds,
    );
  }

  async payOutOfBand(stripeInvoiceId: string): Promise<void> {
    const invoice = await this.getInvoice(stripeInvoiceId);
    this.paidOutOfBand.push(stripeInvoiceId);
    this.byId.set(stripeInvoiceId, { ...invoice, status: "paid" });
  }
}

/** One customer per organization, as the provider's idempotency key gives. */
function customerIdOf(organizationId: string): string {
  return `cus_memory_${organizationId}`;
}

/** The metadata, in key order, as the idempotency key's tail. */
function metadataKey(metadata: Record<string, string>): string {
  return Object.keys(metadata)
    .toSorted()
    .map((name) => `${name}=${metadata[name]}`)
    .join(",");
}
