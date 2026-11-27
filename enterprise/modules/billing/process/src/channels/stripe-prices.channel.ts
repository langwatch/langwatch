// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The prices subject of billing's Stripe channels (Q69): the account's price
 * catalogue, a page at a time, in billing's own price shape.
 */

import type { StripePriceDetail } from "@langwatch/enterprise-billing-contract";

/** One page of the catalogue, and whether Stripe holds more after it. */
export type StripePricePage = Readonly<{ prices: StripePriceDetail[]; hasMore: boolean }>;

/** A price as an ops read sees it: its catalogue facts and how Stripe treats its tax. */
type StripePriceTaxListing = Readonly<{
  id: string;
  active: boolean;
  livemode: boolean;
  currency: string;
  unitAmount: number | null;
  recurring: StripePriceDetail["recurring"];
  lookupKey: string | null;
  taxBehavior: string | null;
}>;
export type StripePriceTaxPage = Readonly<{ prices: StripePriceTaxListing[]; hasMore: boolean }>;

export abstract class StripePricesChannel {
  /** At most `limit` prices, after the price `startingAfter` names when it is given. */
  abstract listPrices(input: { limit: number; startingAfter?: string }): Promise<StripePricePage>;
  /**
   * The same pages with each price's tax behaviour, which the catalogue file does not keep;
   * `timeoutMs` bounds each request, absent uses the client's own timeout.
   */
  abstract listPriceTaxes(input: {
    limit: number;
    startingAfter?: string;
    timeoutMs?: number;
  }): Promise<StripePriceTaxPage>;
}
