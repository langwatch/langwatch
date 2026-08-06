// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Pricing for pulled usage: quantities or a provider figure in, integer
 * nano-USD out, priced exactly once (ADR-088 Decision 2).
 *
 * Two paths, and which one ran is recorded on the record rather than inferred
 * later. A provider that reports cost gets its own number carried verbatim —
 * scaled from the decimal STRING, because `Number * 1e9` on a six-decimal
 * amount lands cents off at the sums an invoice reaches. A provider that
 * reports only quantities is priced through the same `rateSpendNanoUsd` the
 * gateway spend spine uses, so pulled and gateway spend can never be rated by
 * two different tables and then compared.
 *
 * Neither path re-rates downstream. The integer this returns is stamped on the
 * event, copied to the ledger row, and read back unchanged.
 */

import { rateSpendNanoUsd } from "~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";
import { usdToNanoUsd } from "~/server/gateway/wireMoney";
import {
  PULLED_USAGE_COST_BASIS,
  PULLED_USAGE_COST_STATUS,
  type PulledUsageCostBasis,
  type PulledUsageCostStatus,
} from "../schemas/constants";

/** The token counts a usage item carries; zero where the provider is silent. */
export interface PulledUsageQuantities {
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
}

/**
 * A provider that hands us a cost. `costStatus` is the adapter's call and not
 * derivable from the basis: an Anthropic cost report is the invoice figure,
 * while a metered-unit charge reported by another provider is still an
 * approximation of one.
 */
interface ProviderReportedPrice {
  basis: typeof PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED;
  /** The provider's amount in USD. A string keeps every digit it published. */
  costUsd: string | number;
  costStatus: PulledUsageCostStatus;
  quantities: PulledUsageQuantities;
}

/**
 * A provider that hands us only quantities. There is deliberately no
 * `costStatus` field: a figure we derived is not the figure the provider will
 * invoice, so this path has exactly one honest answer and does not take it as
 * input.
 */
interface ComputedPrice {
  basis: typeof PULLED_USAGE_COST_BASIS.COMPUTED;
  model: string;
  quantities: PulledUsageQuantities;
}

export type PulledUsagePriceInput = ProviderReportedPrice | ComputedPrice;

export interface PulledUsagePrice {
  costNanoUsd: number;
  /** Which price table produced a computed cost; null when we produced none. */
  rateVersion: string | null;
  costBasis: PulledUsageCostBasis;
  costStatus: PulledUsageCostStatus;
}

export function pricePulledUsage(
  input: PulledUsagePriceInput,
): PulledUsagePrice {
  if (input.basis === PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED) {
    return {
      costNanoUsd: Number(usdToNanoUsd(input.costUsd)),
      rateVersion: null,
      costBasis: PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED,
      costStatus: input.costStatus,
    };
  }

  const { costNanoUsd, rateVersion } = rateSpendNanoUsd({
    model: input.model,
    usage: {
      input_tokens: input.quantities.tokensInput,
      output_tokens: input.quantities.tokensOutput,
      cache_read_input_tokens: input.quantities.tokensCacheRead,
      cache_creation_input_tokens: input.quantities.tokensCacheWrite,
      reasoning_tokens: 0,
    },
  });

  return {
    costNanoUsd,
    rateVersion,
    costBasis: PULLED_USAGE_COST_BASIS.COMPUTED,
    // Not a branch. A number we derived is never the invoice, so this path
    // has one answer and no input can talk it into another.
    costStatus: PULLED_USAGE_COST_STATUS.ESTIMATE,
  };
}
