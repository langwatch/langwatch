import type { GatewayBudgetChangeInput, GatewayBudgetDebitRow } from "@langwatch/gateway-contract";

import type { GatewayBudgetSpend, GatewayChangeEvents } from "../app/gateway.members.ts";

/** The budget-ledger writes a spend priced outside the gateway's own pipeline lands through. */
export class GatewayBudgetLedgerService {
  private constructor(
    private readonly spend: Pick<GatewayBudgetSpend, "insertDebit"> | undefined,
    private readonly changes: Pick<GatewayChangeEvents, "append">,
  ) {}

  static create({
    spend,
    changes,
  }: {
    spend: Pick<GatewayBudgetSpend, "insertDebit"> | undefined;
    changes: Pick<GatewayChangeEvents, "append">;
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
