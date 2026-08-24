import {
  PULLED_USAGE_COST_BASIS,
  PULLED_USAGE_COST_STATUS,
  type PulledUsageCostBasis,
  type PulledUsageCostStatus,
} from "@langwatch/enterprise-governance-contract";
import type { PulledUsageRatePort } from "../ports/pulled-usage-rate.port";

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

const DECIMAL_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

function usdToNanoUsd(value: string): bigint {
  const raw = value.trim();
  const match = DECIMAL_PATTERN.exec(raw);
  const [, sign = "", whole = "", fraction = "", exponent] = match ?? [];
  if (!match || (whole === "" && fraction === "")) {
    throw new Error(`Not a decimal money amount: ${JSON.stringify(raw)}`);
  }
  const digits = whole + fraction;
  const pointAt = whole.length + Number(exponent ?? 0) + 9;
  let nanoDigits: string;
  let remainder: string;
  if (pointAt <= 0) {
    nanoDigits = "0";
    remainder = "0".repeat(-pointAt) + digits;
  } else if (pointAt >= digits.length) {
    nanoDigits = digits + "0".repeat(pointAt - digits.length);
    remainder = "";
  } else {
    nanoDigits = digits.slice(0, pointAt);
    remainder = digits.slice(pointAt);
  }
  const nano = BigInt(nanoDigits) + (/^[5-9]/.test(remainder) ? 1n : 0n);
  return sign === "-" ? -nano : nano;
}

export class PulledUsagePricingService {
  constructor(private readonly rates: PulledUsageRatePort) {}

  static create(rates: PulledUsageRatePort): PulledUsagePricingService {
    return new PulledUsagePricingService(rates);
  }

  price(input: PulledUsagePriceInput): PulledUsagePrice {
    if (input.basis === PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED) {
      const exact = usdToNanoUsd(input.costUsd);
      if (
        exact > BigInt(Number.MAX_SAFE_INTEGER) ||
        exact < -BigInt(Number.MAX_SAFE_INTEGER)
      ) {
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
