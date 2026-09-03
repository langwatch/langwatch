export type PulledUsageLedgerRow = {
  tenantId: string;
  scopeId: string;
  restatementKey: string;
  amountNanoUsd: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  model: string;
  occurredAt: Date;
  observedAt: Date;
};

export abstract class PulledUsageLedgerPort {
  abstract insert(rows: PulledUsageLedgerRow[]): Promise<void>;
}
