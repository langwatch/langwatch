// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { StripePriceDetail } from "@langwatch/enterprise-billing-contract";
import Stripe from "stripe";

import { type StripePricePage, StripePricesChannel } from "../stripe-prices.channel.ts";

type Operation = keyof StripePricesChannel;

/**
 * Stripe's prices where no provider is composed: answers what a test seeds, in
 * seeding order, a page at a time, and refuses a cursor it never held as Stripe does.
 */
export class MemoryStripePricesChannel extends StripePricesChannel {
  readonly listings: { limit: number; startingAfter?: string }[] = [];
  private readonly held: StripePriceDetail[] = [];
  private readonly refusals = new Map<Operation, Error>();

  private constructor() {
    super();
  }

  static create(): MemoryStripePricesChannel {
    return new MemoryStripePricesChannel();
  }

  /** Puts a price in the account's catalogue. */
  seed({ price }: { price: StripePriceDetail }): void {
    this.held.push(price);
  }

  /** Makes `operation` throw `error` from now on, as a failing provider would. */
  refuse({ operation, error }: { operation: Operation; error: Error }): void {
    this.refusals.set(operation, error);
  }

  async listPrices({
    limit,
    startingAfter,
  }: {
    limit: number;
    startingAfter?: string;
  }): Promise<StripePricePage> {
    const refusal = this.refusals.get("listPrices");
    if (refusal) throw refusal;
    this.listings.push(startingAfter === undefined ? { limit } : { limit, startingAfter });
    const start = startingAfter === undefined ? 0 : this.indexOf(startingAfter) + 1;
    return {
      prices: this.held.slice(start, start + limit),
      hasMore: start + limit < this.held.length,
    };
  }

  private indexOf(priceId: string): number {
    const index = this.held.findIndex((price) => price.id === priceId);
    if (index >= 0) return index;
    throw new Stripe.errors.StripeInvalidRequestError({
      type: "invalid_request_error",
      code: "resource_missing",
      message: `No such price: '${priceId}'`,
    });
  }
}
