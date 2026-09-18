import {
  PULLED_USAGE_COST_BASIS,
  PULLED_USAGE_COST_STATUS,
  PULLED_USAGE_DEFAULT_CURRENCY_CODE,
  type PulledUsageCostBasis,
  type PulledUsageCostStatus,
} from "@langwatch/enterprise-governance-contract";
import { usdToNanoUsd } from "@langwatch/gateway-contract";

import type { PulledUsageRateReader } from "../app/governance.members.ts";

export type PulledUsageQuantities = {
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
};

/**
 * A provider that hands us a cost, in a currency of its own choosing. The
 * amount and the code naming it arrive and are consumed together — split
 * across two call sites, a euro figure reads as dollars.
 */
export type ProviderReportedPriceInput = {
  basis: typeof PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED;
  /**
   * The provider's amount as a decimal string, in ITS OWN currency. Named for
   * the sources that predate currencies, all of which reported dollars.
   */
  costUsd: string;
  /** ISO 4217 code for the amount above. Absent means dollars. */
  currencyCode?: string;
  /**
   * The biller's own conversion of that amount into dollars, as a decimal
   * string, when it published one. Undefined when it did not — nothing here
   * fills it in from a rate of our own.
   */
  costUsdBiller?: string;
  costStatus: PulledUsageCostStatus;
};

export type PulledUsagePriceInput =
  | ProviderReportedPriceInput
  | {
      basis: typeof PULLED_USAGE_COST_BASIS.COMPUTED;
      model: string;
      quantities: PulledUsageQuantities;
    };

export type PulledUsagePrice = {
  /** The amount in the provider's own minor units. See the event schema. */
  costNanoMinor: number;
  /** ISO 4217 code for `costNanoMinor`, and the only thing that denominates it. */
  currencyCode: string;
  /** The biller's own dollar figure, or null when it published none. */
  costNanoUsd: number | null;
  /** Which price table produced a computed cost; null when we produced none. */
  rateVersion: string | null;
  costBasis: PulledUsageCostBasis;
  costStatus: PulledUsageCostStatus;
};

// Scales decimal string to nano-minor units in bigint, converts to number
// (prevents quiet rounding). Throws if exceeds 2^53 (float64 max safe integer).
function providerCostToNanoMinor(amount: string): number {
  const exact = usdToNanoUsd(amount);
  if (exact > BigInt(Number.MAX_SAFE_INTEGER) || exact < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      `pulled usage cost ${amount} exceeds the exactly-representable nano-USD range; refusing to round a money figure`,
    );
  }
  return Number(exact);
}

export class PulledUsagePricingService {
  private constructor(private readonly rates: PulledUsageRateReader) {}

  static create(rates: PulledUsageRateReader): PulledUsagePricingService {
    return new PulledUsagePricingService(rates);
  }

  price(input: PulledUsagePriceInput): PulledUsagePrice {
    if (input.basis === PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED) {
      return {
        costNanoMinor: providerCostToNanoMinor(input.costUsd),
        // The code that came with the amount, or dollars — which is what every
        // adapter written before currencies reported. Never read from anywhere
        // but this input, because the caller already decided which amount it
        // was handing over and this is that amount's own denomination.
        currencyCode: input.currencyCode ?? PULLED_USAGE_DEFAULT_CURRENCY_CODE,
        // Scaled by the same pure function, because it is the same kind of
        // figure — a decimal string of money — and only its denomination
        // differs. Absent stays absent: there is no rate here to fill it with.
        costNanoUsd:
          input.costUsdBiller === undefined ? null : providerCostToNanoMinor(input.costUsdBiller),
        rateVersion: null,
        costBasis: PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED,
        costStatus: input.costStatus,
      };
    }

    const rated = this.rates.rate({
      model: input.model,
      quantities: input.quantities,
    });

    return {
      costNanoMinor: rated.costNanoUsd,
      // We priced it, off a table that is denominated in dollars. There is no
      // other currency this path can produce.
      currencyCode: PULLED_USAGE_DEFAULT_CURRENCY_CODE,
      // The amount above already IS the dollar figure; a copy here would be a
      // second number to keep in step for no reader's benefit.
      costNanoUsd: null,
      rateVersion: rated.rateVersion,
      costBasis: PULLED_USAGE_COST_BASIS.COMPUTED,
      // Not a branch. A number we derived is never the invoice, so this path
      // has one answer and no input can talk it into another.
      costStatus: PULLED_USAGE_COST_STATUS.ESTIMATE,
    };
  }
}
