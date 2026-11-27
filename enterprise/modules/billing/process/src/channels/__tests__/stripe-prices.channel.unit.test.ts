// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** @see enterprise/modules/billing/specs/billing.feature */
import type { StripePriceDetail } from "@langwatch/enterprise-billing-contract";
import { stripeDouble } from "@langwatch/test-harness/client-doubles/stripe";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { HttpStripePricesChannel } from "../http/http.stripe-prices.channel.ts";
import { MemoryStripePricesChannel } from "../memory/memory.stripe-prices.channel.ts";
import type { StripePricesChannel } from "../stripe-prices.channel.ts";

const monthly = (id: string): StripePriceDetail => ({
  id,
  active: true,
  livemode: false,
  product: `prod_${id}`,
  unitAmount: 9900,
  currency: "usd",
  type: "recurring",
  recurring: { interval: "month", intervalCount: 1 },
  nickname: "Pro Monthly",
  lookupKey: "PRO",
  metadata: { langwatch_key: "PRO" },
});

const EXPECTED: StripePriceDetail[] = [
  monthly("price_a"),
  { ...monthly("price_b"), product: "prod_object" },
  {
    ...monthly("price_c"),
    livemode: true,
    unitAmount: 500,
    type: "one_time",
    recurring: null,
    nickname: null,
    lookupKey: null,
    metadata: {},
  },
];

/** How Stripe treats tax on each price; price_c has never been set. */
const TAX_BEHAVIORS: Record<string, Stripe.Price.TaxBehavior> = {
  price_a: "exclusive",
  price_b: "inclusive",
};

/** The SDK's own shape of each expected price; price_b's product arrives expanded. */
const AT_THE_PROVIDER = EXPECTED.map(
  (detail) =>
    ({
      id: detail.id,
      object: "price",
      active: detail.active,
      livemode: detail.livemode,
      product:
        detail.id === "price_b"
          ? ({ id: "prod_object", object: "product" } as Stripe.Product)
          : detail.product,
      unit_amount: detail.unitAmount,
      currency: detail.currency,
      type: detail.type,
      recurring: detail.recurring
        ? { interval: detail.recurring.interval, interval_count: detail.recurring.intervalCount }
        : null,
      nickname: detail.nickname,
      lookup_key: detail.lookupKey,
      metadata: detail.metadata,
      tax_behavior: TAX_BEHAVIORS[detail.id] ?? null,
    }) as Stripe.Price,
);

const rateLimited = () =>
  new Stripe.errors.StripeRateLimitError({ type: "rate_limit_error", message: "slow down" });

function overTheProvider({ refused }: { refused?: Error } = {}): StripePricesChannel {
  const stripe = stripeDouble({
    prices: {
      list: async (params?: Stripe.PriceListParams | Stripe.RequestOptions) => {
        if (refused) throw refused;
        const asked: Stripe.PriceListParams = params && "limit" in params ? params : {};
        const after = AT_THE_PROVIDER.findIndex((price) => price.id === asked.starting_after);
        const data = AT_THE_PROVIDER.slice(after + 1, after + 1 + (asked.limit ?? 10));
        const hasMore = after + 1 + data.length < AT_THE_PROVIDER.length;
        return { object: "list", data, has_more: hasMore, url: "/v1/prices" };
      },
    },
  });
  return HttpStripePricesChannel.create({ stripe });
}

function overTheTwin({ refused }: { refused?: Error } = {}): StripePricesChannel {
  const prices = MemoryStripePricesChannel.create();
  for (const price of EXPECTED) {
    const taxBehavior = TAX_BEHAVIORS[price.id];
    prices.seed({ price, ...(taxBehavior ? { taxBehavior } : {}) });
  }
  if (refused) {
    prices.refuse({ operation: "listPrices", error: refused });
    prices.refuse({ operation: "listPriceTaxes", error: refused });
  }
  return prices;
}

const tiers = [
  { tier: "the provider", compose: overTheProvider },
  { tier: "the memory twin", compose: overTheTwin },
];

describe.each(tiers)("Stripe prices over $tier", ({ compose }) => {
  describe("given three prices", () => {
    /** @scenario "Stripe prices page alike over the provider and its memory twin" */
    it("answers two a page in billing's price shape, then the third", async () => {
      const prices = compose();

      const first = await prices.listPrices({ limit: 2 });
      const second = await prices.listPrices({ limit: 2, startingAfter: "price_b" });

      expect(first).toEqual({ prices: EXPECTED.slice(0, 2), hasMore: true });
      expect(second).toEqual({ prices: EXPECTED.slice(2), hasMore: false });
    });

    it("maps an expanded product to its id and a one-time price to no recurrence", async () => {
      const { prices } = await compose().listPrices({ limit: 3 });

      expect(prices[1]?.product).toBe("prod_object");
      expect(prices[2]?.recurring).toBeNull();
    });
  });

  describe("when the listing is read with tax behaviour", () => {
    it("answers each price's tax behaviour, a page at a time", async () => {
      const prices = compose();

      const first = await prices.listPriceTaxes({ limit: 2 });
      const second = await prices.listPriceTaxes({ limit: 2, startingAfter: "price_b" });

      expect(first.hasMore).toBe(true);
      expect(first.prices.map(({ id, taxBehavior }) => ({ id, taxBehavior }))).toEqual([
        { id: "price_a", taxBehavior: "exclusive" },
        { id: "price_b", taxBehavior: "inclusive" },
      ]);
      expect(second).toEqual({
        prices: [
          {
            id: "price_c",
            active: true,
            livemode: true,
            currency: "usd",
            unitAmount: 500,
            recurring: null,
            lookupKey: null,
            taxBehavior: null,
          },
        ],
        hasMore: false,
      });
    });
  });

  describe("when the provider refuses the listing", () => {
    it("passes the provider's own error through", async () => {
      await expect(
        compose({ refused: rateLimited() }).listPrices({ limit: 2 }),
      ).rejects.toMatchObject({ type: "StripeRateLimitError" });
      await expect(
        compose({ refused: rateLimited() }).listPriceTaxes({ limit: 2 }),
      ).rejects.toMatchObject({ type: "StripeRateLimitError" });
    });
  });
});
