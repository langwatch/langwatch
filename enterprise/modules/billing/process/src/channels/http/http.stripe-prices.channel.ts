// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { StripePriceDetail } from "@langwatch/enterprise-billing-contract";
import type Stripe from "stripe";

import { type StripePricePage, StripePricesChannel } from "../stripe-prices.channel.ts";

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
