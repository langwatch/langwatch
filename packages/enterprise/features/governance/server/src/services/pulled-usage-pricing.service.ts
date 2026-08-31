import {
  PULLED_USAGE_COST_BASIS,
  PULLED_USAGE_COST_STATUS,
  type PulledUsageCostBasis,
  type PulledUsageCostStatus,
} from "@langwatch/enterprise-governance-contract";
import type { PulledUsageRatePort } from "../ports/pulled-usage-rate.port";
import { usdToNanoUsd } from "@langwatch/gateway-contract";

export type PulledUsageQuantities = {
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
};

export type PulledUsagePriceInput =
  | {
      basis: typeof PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED;
      costUsd: string;
      costStatus: PulledUsageCostStatus;
    }
  | {
      basis: typeof PULLED_USAGE_COST_BASIS.COMPUTED;
      model: string;
      quantities: PulledUsageQuantities;
    };

export type PulledUsagePrice = {
  costNanoUsd: number;
  rateVersion: string | null;
  costBasis: PulledUsageCostBasis;
  costStatus: PulledUsageCostStatus;
};

export class PulledUsagePricingService {
  private constructor(private readonly rates: PulledUsageRatePort) {}

  static create(rates: PulledUsageRatePort): PulledUsagePricingService {
    return new PulledUsagePricingService(rates);
  }

  price(input: PulledUsagePriceInput): PulledUsagePrice {
    if (input.basis === PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED) {
      const exact = usdToNanoUsd(input.costUsd);
      if (exact > BigInt(Number.MAX_SAFE_INTEGER) || exact < -BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(
          `pulled usage cost ${input.costUsd} exceeds the exactly-representable nano-USD range; refusing to round a money figure`,
        );
      }
      return {
        costNanoUsd: Number(exact),
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
      ...rated,
      costBasis: PULLED_USAGE_COST_BASIS.COMPUTED,
      costStatus: PULLED_USAGE_COST_STATUS.ESTIMATE,
    };
  }
}
