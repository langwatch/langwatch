/**
 * Every budget-ledger read is a built statement on the reader identity. A project's reads carry
 * `TenantId = {tenantId}` and that tenant as the setting; caller values are bound, never spliced.
 */
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { GatewayBudgetClickHouseRepository } from "../clickhouse.gateway-budget.repository.ts";
import type { GatewayClickHouseClient } from "../clickhouse.gateway-session.store.ts";

type Sent = Parameters<GatewayClickHouseClient["read"]>[0];

const OCCURRED_AT = Temporal.Instant.from("2026-10-20T04:53:44Z");

function repositoryOver() {
  const sent: Sent[] = [];
  const client: GatewayClickHouseClient = {
    read: async (input) => {
      sent.push(input);
      return { rows: [] };
    },
    insert: async () => undefined,
  };
  const repository = GatewayBudgetClickHouseRepository.create(async () => client);
  const statements = () => sent.map((each) => each.statement as ReaderReadStatement);
  return { repository, sent, statements };
}

function expectProjectRead(statement: ReaderReadStatement | undefined, tenantId: string) {
  expect(statement).toMatchObject({ identity: "reader", kind: "tenant", tenantId });
  expect(statement?.tenantIds).toBeUndefined();
  expect(statement?.settings).toMatchObject({ SQL_langwatch_tenant_ids: tenantId });
  expect(statement?.sql).toContain("TenantId = {tenantId:String}");
  expect(statement?.params).toMatchObject({ tenantId });
}

function debit(budgetId: string) {
  return {
    tenantId: "project-1",
    budgetId,
    scope: "PROJECT" as const,
    scopeId: "project-1",
    window: "MONTH" as const,
    virtualKeyId: "vk-1",
    gatewayRequestId: "req-1",
    amountNanoUsd: 1_000,
    tokensInput: 1,
    tokensOutput: 1,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    model: "gpt-5-mini",
    status: "SUCCESS" as const,
    occurredAt: OCCURRED_AT,
  };
}

describe("GatewayBudgetClickHouseRepository built reads", () => {
  describe("when a debit probes the ledger for its request", () => {
    it("reads the project's ledger by the request id index, with no window it lacks", async () => {
      const { repository, sent, statements } = repositoryOver();

      await repository.insertDebit([debit("budget-1")]);

      expectProjectRead(statements()[0], "project-1");
      expect(statements()[0]?.sql).toContain("FROM gateway_budget_ledger_events");
      expect(statements()[0]?.sql).toContain(
        "{{idBound:gateway_budget_ledger_events.GatewayRequestId:",
      );
      expect(statements()[0]?.params).toMatchObject({ v0: "req-1" });
      expect(sent[0]?.idBound).toEqual({ fallback: "unbounded" });
    });
  });

  describe("when a debit names several budgets on one request", () => {
    it("probes the distinct budgets already on the request, bound by the id index", async () => {
      const { repository, sent, statements } = repositoryOver();

      await repository.insertDebitsForBudgets([debit("budget-1"), debit("budget-2")]);

      const statement = statements()[0];
      expectProjectRead(statement, "project-1");
      expect(statement?.sql).toContain("SELECT DISTINCT");
      expect(statement?.sql).toContain("BudgetId IN (");
      expect(Object.values(statement?.params ?? {})).toContainEqual(["budget-1", "budget-2"]);
      expect(sent[0]?.idBound).toEqual({ fallback: "unbounded" });
    });
  });

  describe("when pulled provider usage is restated", () => {
    it("probes the latest version of each pulled row inside the batch's span", async () => {
      const { repository, statements } = repositoryOver();

      await repository.insertPulledUsageRows([
        {
          tenantId: "project-1",
          scopeId: "org-1",
          restatementKey: "provider-a:2026-10-20",
          amountNanoUsd: 1_000,
          tokensInput: 1,
          tokensOutput: 1,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          model: "gpt-5-mini",
          occurredAt: OCCURRED_AT,
          observedAt: OCCURRED_AT,
        },
      ]);

      const statement = statements()[0];
      expectProjectRead(statement, "project-1");
      expect(statement?.sql).toContain(
        "argMax(AmountNanoUSD, EventTimestamp) AS LatestAmountNanoUSD",
      );
      expect(statement?.sql).toContain("GROUP BY GatewayRequestId");
    });
  });

  describe("when a scope's pulled usage totals are read", () => {
    it("collapses each usage item in a derived read on the project", async () => {
      const { repository, statements } = repositoryOver();

      await repository.readPulledUsageTotals({
        tenantId: "project-1",
        scopeIds: ["org-1", "team-1"],
        from: OCCURRED_AT.subtract({ hours: 24 }),
        to: OCCURRED_AT,
      });

      const statement = statements()[0];
      expectProjectRead(statement, "project-1");
      expect(statement?.sql).toContain(") AS items");
      expect(Object.values(statement?.params ?? {})).toContainEqual(["org-1", "team-1"]);
    });

    it("answers empty without a statement when no scope is visible", async () => {
      const { repository, statements } = repositoryOver();

      await repository.readPulledUsageTotals({
        tenantId: "project-1",
        scopeIds: [],
        from: OCCURRED_AT,
        to: OCCURRED_AT,
      });

      expect(statements()).toHaveLength(0);
    });
  });

  describe("when the budget spend read is abandoned on abort", () => {
    it("passes the caller's signal to every spend statement", async () => {
      const { repository, sent } = repositoryOver();
      const signal = new AbortController().signal;

      await repository.findSpendForBudgetsAcrossTenantsUntil({
        tenantIds: ["project-1", "project-2"],
        budgets: [
          { budgetId: "budget-1", scope: "ORGANIZATION", scopeId: "org-1", window: "MONTH" },
        ],
        signal,
      });

      expect(sent.length).toBeGreaterThan(0);
      for (const each of sent) expect(each.signal).toBe(signal);
    });
  });
});
