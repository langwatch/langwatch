import type { SpendUsage } from "../processes/gateway-spend-commands.process";

/**
 * Prices measured quantities.
 *
 * One rating seam for the whole vertical: the voice settlement and the
 * gateway's own drainer must not price the same call twice, which is how two
 * money surfaces come to disagree about it.
 */
export abstract class GatewaySpendRatingPort {
  abstract rate(input: { model: string; usage: SpendUsage; rateVersion?: string }): {
    costNanoUsd: number;
    rateVersion: string;
  };
}
