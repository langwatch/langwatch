import type { PulledUsagePricedEventData } from "@langwatch/enterprise-governance-contract";
import type { GatewayBudgetChangeInput, GatewayBudgetDebitRow } from "@langwatch/gateway-contract";
import { Temporal } from "@langwatch/time";

import type { GatewayBudgetSpendRepository } from "../../../repositories/gateway-budget-spend.repository.ts";
import type { GatewayChangeEventsRepository } from "../../../repositories/gateway-change-event.repository.ts";

/** The budget-ledger writes a spend priced outside the gateway's own pipeline lands through. */
export class GatewayBudgetLedgerService {
  private constructor(
    private readonly spend:
      | Pick<GatewayBudgetSpendRepository, "insertDebit" | "insertPulledUsageRows">
      | undefined,
    private readonly changes: Pick<GatewayChangeEventsRepository, "append">,
  ) {}

  static create({
    spend,
    changes,
  }: {
    spend: Pick<GatewayBudgetSpendRepository, "insertDebit" | "insertPulledUsageRows"> | undefined;
    changes: Pick<GatewayChangeEventsRepository, "append">;
  }): GatewayBudgetLedgerService {
    return new GatewayBudgetLedgerService(spend, changes);
  }

  async insertDebit(rows: readonly GatewayBudgetDebitRow[]): Promise<void> {
    if (!this.spend) throw new Error("This deployment composed no budget ledger to debit");

    await this.spend.insertDebit([...rows]);
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

  async appendBudgetChange({
    organizationId,
    projectId,
    payload,
  }: GatewayBudgetChangeInput): Promise<void> {
    await this.changes.append({ organizationId, projectId, kind: "BUDGET_UPDATED", payload });
  }
}
