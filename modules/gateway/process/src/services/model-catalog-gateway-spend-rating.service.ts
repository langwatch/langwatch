import {
  currentRegistryRateVersion,
  findSpendRatingFaults,
  rateSpendNanoUsd,
  type SpendUsage,
} from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";

import { type GatewaySpendRating } from "../app/gateway.members.ts";

const logger = createLogger("langwatch:gateway-spend:rating");

const FAULT_MESSAGES = {
  "spend_rating.unpriced_quantities":
    "rate rule prices none of the quantities this request reported; spend rated at zero",
  "spend_rating.no_rate_rule": "no rate rule matched; spend rated at zero",
} as const;

/**
 * The vertical's ONE rating seam over the contract's rule: voice settlement and the drainer
 * both take this port, so one call is never priced twice; a zero charge that burned
 * something is stated once, by code.
 */
export class ModelCatalogGatewaySpendRatingService implements GatewaySpendRating {
  private constructor() {}

  static create(): ModelCatalogGatewaySpendRatingService {
    return new ModelCatalogGatewaySpendRatingService();
  }

  rate(input: { model: string; usage: SpendUsage; rateVersion?: string }): {
    costNanoUsd: number;
    rateVersion: string;
  } {
    return this.rateSpendNanoUsd(input);
  }

  currentRegistryRateVersion(): string {
    return currentRegistryRateVersion();
  }

  rateSpendNanoUsd(input: { model: string; usage: SpendUsage; rateVersion?: string }): {
    costNanoUsd: number;
    rateVersion: string;
  } {
    const rated = rateSpendNanoUsd(input);
    if (rated.costNanoUsd !== 0) return rated;
    for (const fault of findSpendRatingFaults(input)) {
      logger.warn(
        { ...fault, model: input.model, rateVersion: rated.rateVersion },
        FAULT_MESSAGES[fault.code],
      );
    }
    return rated;
  }
}
