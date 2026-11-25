// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The prices subject of billing's Stripe channels (Q69): the account's price
 * catalogue, a page at a time, in billing's own price shape.
 */

import type { StripePriceDetail } from "@langwatch/enterprise-billing-contract";

/** One page of the catalogue, and whether Stripe holds more after it. */
export type StripePricePage = Readonly<{ prices: StripePriceDetail[]; hasMore: boolean }>;

export abstract class StripePricesChannel {
  /** At most `limit` prices, after the price `startingAfter` names when it is given. */
  abstract listPrices(input: { limit: number; startingAfter?: string }): Promise<StripePricePage>;
}
