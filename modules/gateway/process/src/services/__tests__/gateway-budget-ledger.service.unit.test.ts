import type { PulledUsagePricedEventData } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { GatewayBudgetLedgerService } from "../../features/budget/services/gateway-budget-ledger.service.ts";
import type {
  GatewayBudgetSpendRepository,
  PulledUsageRow,
} from "../../repositories/gateway-budget-spend.repository.ts";

class RecordingLedger implements Pick<GatewayBudgetSpendRepository, "insertPulledUsageRows"> {
  readonly batches: PulledUsageRow[][] = [];

  async insertPulledUsageRows(rows: PulledUsageRow[]): Promise<void> {
    this.batches.push(rows);
  }
}

const fact: PulledUsagePricedEventData = {
  restatementKey: "restatement_1",
  organizationId: "org_1",
  teamId: null,
  scopeId: "org_1",
  model: "gpt-5",
  amountNanoUsd: 1_500_000_000,
  tokensInput: 10,
  tokensOutput: 20,
  tokensCacheRead: 0,
  tokensCacheWrite: 0,
  occurredAtMs: Date.UTC(2026, 8, 1),
  observedAtMs: Date.UTC(2026, 8, 2),
};

describe("GatewayBudgetLedgerService", () => {
  describe("when a priced pulled usage is debited", () => {
    it("writes one row under the fact's pulled scope", async () => {
      const ledger = new RecordingLedger();
      const service = GatewayBudgetLedgerService.create({ spend: ledger });

      await service.debitPulledUsage({ tenantId: "project_gov", fact });

      expect(ledger.batches).toHaveLength(1);
      expect(ledger.batches[0]?.[0]).toMatchObject({
        tenantId: "project_gov",
        scopeId: "org_1",
        restatementKey: "restatement_1",
        amountNanoUsd: 1_500_000_000,
      });
    });

    it("refuses when the deployment composed no ledger", async () => {
      const service = GatewayBudgetLedgerService.create({ spend: undefined });

      await expect(service.debitPulledUsage({ tenantId: "project_gov", fact })).rejects.toThrow(
        Error,
      );
    });
  });
});
