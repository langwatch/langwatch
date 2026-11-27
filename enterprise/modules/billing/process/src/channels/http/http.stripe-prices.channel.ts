// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { StripePriceDetail } from "@langwatch/enterprise-billing-contract";
import type Stripe from "stripe";

import {
  type StripePricePage,
  StripePricesChannel,
  type StripePriceTaxPage,
} from "../stripe-prices.channel.ts";

/** Stripe's prices over billing's one client, each with its product expanded. */
export class HttpStripePricesChannel extends StripePricesChannel {
  private constructor(private readonly stripe: Stripe) {
    super();
  }

  static create(input: { stripe: Stripe }): HttpStripePricesChannel {
    return new HttpStripePricesChannel(input.stripe);
  }

  async listPrices({
    limit,
    startingAfter,
  }: {
    limit: number;
    startingAfter?: string;
  }): Promise<StripePricePage> {
    const page = await this.stripe.prices.list({
      limit,
      starting_after: startingAfter,
      expand: ["data.product"],
    });
    return { prices: page.data.map(toPriceDetail), hasMore: page.has_more };
  }

  async listPriceTaxes({
    limit,
    startingAfter,
  }: {
    limit: number;
    startingAfter?: string;
  }): Promise<StripePriceTaxPage> {
    const page = await this.stripe.prices.list({ limit, starting_after: startingAfter });
    return {
      prices: page.data.map((price) => {
        const detail = toPriceDetail(price);
        return {
          id: detail.id,
          active: detail.active,
          livemode: detail.livemode,
          currency: detail.currency,
          unitAmount: detail.unitAmount,
          recurring: detail.recurring,
          lookupKey: detail.lookupKey,
          taxBehavior: price.tax_behavior ?? null,
        };
      }),
      hasMore: page.has_more,
    };
  }
}

function toPriceDetail(price: Stripe.Price): StripePriceDetail {
  const productId = typeof price.product === "string" ? price.product : (price.product?.id ?? null);

  return {
    id: price.id,
    active: price.active,
    livemode: price.livemode,
    product: productId,
    unitAmount: price.unit_amount,
    currency: price.currency,
    type: price.type,
    recurring: price.recurring
      ? { interval: price.recurring.interval, intervalCount: price.recurring.interval_count }
      : null,
    nickname: price.nickname,
    lookupKey: price.lookup_key,
    metadata: price.metadata,
  };
}
