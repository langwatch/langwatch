import type { GatewayBudgetChangeInput, GatewayBudgetDebitRow } from "@langwatch/gateway-contract";

import type { GatewayBudgetSpendRepository } from "../repositories/gateway-budget-spend.repository.ts";
import type { GatewayChangeEventsRepository } from "../repositories/gateway-change-event.repository.ts";

/** The budget-ledger writes a spend priced outside the gateway's own pipeline lands through. */
export class GatewayBudgetLedgerService {
  private constructor(
    private readonly spend: Pick<GatewayBudgetSpendRepository, "insertDebit"> | undefined,
    private readonly changes: Pick<GatewayChangeEventsRepository, "append">,
  ) {}

  static create({
    spend,
    changes,
  }: {
    spend: Pick<GatewayBudgetSpendRepository, "insertDebit"> | undefined;
    changes: Pick<GatewayChangeEventsRepository, "append">;
  }): GatewayBudgetLedgerService {
    return new GatewayBudgetLedgerService(spend, changes);
  }

  async insertDebit(rows: readonly GatewayBudgetDebitRow[]): Promise<void> {
    if (!this.spend) throw new Error("This deployment composed no budget ledger to debit");

    await this.spend.insertDebit([...rows]);
  }

  async appendBudgetChange({
    organizationId,
    projectId,
    payload,
  }: GatewayBudgetChangeInput): Promise<void> {
    await this.changes.append({ organizationId, projectId, kind: "BUDGET_UPDATED", payload });
  }
}
