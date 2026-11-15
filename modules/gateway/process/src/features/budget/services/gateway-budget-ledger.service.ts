import type { PulledUsagePricedEventData } from "@langwatch/enterprise-governance-contract";
import { Temporal } from "@langwatch/time";

import type { GatewayBudgetSpendRepository } from "../../../repositories/gateway-budget-spend.repository.ts";

/** The ledger write for governance's priced pulled usage, under the ledger's pulled scope. */
export class GatewayBudgetLedgerService {
  private constructor(
    private readonly spend: Pick<GatewayBudgetSpendRepository, "insertPulledUsageRows"> | undefined,
  ) {}

  static create({
    spend,
  }: {
    spend: Pick<GatewayBudgetSpendRepository, "insertPulledUsageRows"> | undefined;
  }): GatewayBudgetLedgerService {
    return new GatewayBudgetLedgerService(spend);
  }

  /** Debits governance's priced pulled-usage fact under the ledger's pulled scope (Q208C). */
  async debitPulledUsage({
    tenantId,
    fact,
  }: {
    tenantId: string;
    fact: PulledUsagePricedEventData;
  }): Promise<void> {
    if (!this.spend) throw new Error("This deployment composed no budget ledger to debit");

    await this.spend.insertPulledUsageRows([
      {
        tenantId,
        scopeId: fact.scopeId,
        restatementKey: fact.restatementKey,
        amountNanoUsd: fact.amountNanoUsd,
        tokensInput: fact.tokensInput,
        tokensOutput: fact.tokensOutput,
        tokensCacheRead: fact.tokensCacheRead,
        tokensCacheWrite: fact.tokensCacheWrite,
        model: fact.model,
        occurredAt: Temporal.Instant.fromEpochMilliseconds(fact.occurredAtMs),
        observedAt: Temporal.Instant.fromEpochMilliseconds(fact.observedAtMs),
      },
    ]);
  }
}
