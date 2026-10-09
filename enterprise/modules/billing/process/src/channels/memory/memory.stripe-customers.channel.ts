// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import Stripe from "stripe";

import { type StripeCustomer, StripeCustomersChannel } from "../stripe-customers.channel.ts";

type Operation = "createCustomer" | "deleteCustomer" | "getCustomer";

/**
 * Stripe's customers where no provider is composed. Mints `cus_memory_<n>`,
 * keeps a deleted customer readable as deleted, and refuses an unknown id with
 * the provider's own `resource_missing` error.
 */
export class MemoryStripeCustomersChannel extends StripeCustomersChannel {
  readonly created: { email: string; name: string }[] = [];
  readonly deleted: string[] = [];
  private readonly held = new Map<string, StripeCustomer>();
  private readonly refusals = new Map<Operation, Error>();

  private constructor() {
    super();
  }

  static create(): MemoryStripeCustomersChannel {
    return new MemoryStripeCustomersChannel();
  }

  /** Puts a customer at the provider, as a test declares it. */
  seed({
    id,
    currency = null,
    deleted = false,
  }: {
    id: string;
    currency?: string | null;
    deleted?: boolean;
  }): void {
    this.held.set(id, deleted ? { id, deleted: true } : { id, deleted: false, currency });
  }

  /** Makes `operation` throw `error` from now on, as a failing provider would. */
  refuse({ operation, error }: { operation: Operation; error: Error }): void {
    this.refusals.set(operation, error);
  }

  async createCustomer({ email, name }: { email: string; name: string }): Promise<{ id: string }> {
    this.throwIfRefused("createCustomer");
    this.created.push({ email, name });
    const id = `cus_memory_${this.created.length}`;
    this.held.set(id, { id, deleted: false, currency: null });
    return { id };
  }

  async deleteCustomer({ customerId }: { customerId: string }): Promise<void> {
    this.throwIfRefused("deleteCustomer");
    this.find(customerId);
    this.deleted.push(customerId);
    this.held.set(customerId, { id: customerId, deleted: true });
  }

  async getCustomer({ customerId }: { customerId: string }): Promise<StripeCustomer> {
    this.throwIfRefused("getCustomer");
    return this.find(customerId);
  }

  private throwIfRefused(operation: Operation): void {
    const refusal = this.refusals.get(operation);
    if (refusal) throw refusal;
  }

  private find(customerId: string): StripeCustomer {
    const customer = this.held.get(customerId);
    if (customer) return customer;
    throw new Stripe.errors.StripeInvalidRequestError({
      type: "invalid_request_error",
      code: "resource_missing",
      message: `No such customer: '${customerId}'`,
    });
  }
}
