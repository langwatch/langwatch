export type PulledUsageRateInput = {
  model: string;
  quantities: {
    tokensInput: number;
    tokensOutput: number;
    tokensCacheRead: number;
    tokensCacheWrite: number;
  };
};

export abstract class PulledUsageRatePort {
  abstract rate(input: PulledUsageRateInput): {
    costNanoUsd: number;
    rateVersion: string;
  };
}
