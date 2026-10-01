import type { GatewayBudgetDebitRow } from "@langwatch/gateway-contract";
import { fromDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type {
  AppendGatewayChangeEventInput,
  BudgetDebitRow,
  GatewayBudgetSpend,
  GatewayChangeEvents,
} from "../../app/gateway.members.ts";
import { GatewayBudgetLedgerService } from "../gateway-budget-ledger.service.ts";

class RecordingLedger implements Pick<GatewayBudgetSpend, "insertDebit"> {
  readonly batches: BudgetDebitRow[][] = [];

  async insertDebit(rows: BudgetDebitRow[]): Promise<void> {
    this.batches.push(rows);
  }
}

class RecordingChanges implements Pick<GatewayChangeEvents, "append"> {
  readonly appended: AppendGatewayChangeEventInput[] = [];

  async append(input: AppendGatewayChangeEventInput): Promise<{ revision: bigint }> {
    this.appended.push(input);
    return { revision: BigInt(this.appended.length) };
  }
}

const row: GatewayBudgetDebitRow = {
  tenantId: "project_gov",
  budgetId: "budget_1",
  scope: "ORGANIZATION",
  scopeId: "org_1",
  window: "MONTH",
  virtualKeyId: "_ingestion_:source_1",
  gatewayRequestId: "request_1",
  amountNanoUsd: 1_500_000_000,
  tokensInput: 10,
  tokensOutput: 20,
  tokensCacheRead: 0,
  tokensCacheWrite: 0,
  model: "gpt-5",
  durationMs: 0,
  status: "SUCCESS",
  occurredAt: fromDate(new Date("2026-09-01T00:00:00.000Z")),
};

describe("GatewayBudgetLedgerService", () => {
  describe("when a priced spend is debited", () => {
    it("writes the rows to the budget ledger as one batch", async () => {
      const ledger = new RecordingLedger();
      const service = GatewayBudgetLedgerService.create({
        spend: ledger,
        changes: new RecordingChanges(),
      });

      await service.insertDebit([row, { ...row, budgetId: "budget_2" }]);

      expect(ledger.batches.map((batch) => batch.map(({ budgetId }) => budgetId))).toEqual([
        ["budget_1", "budget_2"],
      ]);
    });

    it("refuses when the deployment composed no ledger", async () => {
      const service = GatewayBudgetLedgerService.create({
        spend: undefined,
        changes: new RecordingChanges(),
      });

      await expect(service.insertDebit([row])).rejects.toThrow(Error);
    });
  });

  describe("when the budget change is announced", () => {
    it("appends a BUDGET_UPDATED event carrying the payload", async () => {
      const changes = new RecordingChanges();
      const service = GatewayBudgetLedgerService.create({ spend: new RecordingLedger(), changes });

      await service.appendBudgetChange({
        organizationId: "org_1",
        projectId: "project_gov",
        payload: { source: "ingestion_source", budgetIds: ["budget_1"] },
      });

      expect(changes.appended).toEqual([
        {
          organizationId: "org_1",
          projectId: "project_gov",
          kind: "BUDGET_UPDATED",
          payload: { source: "ingestion_source", budgetIds: ["budget_1"] },
        },
      ]);
    });
  });
});
