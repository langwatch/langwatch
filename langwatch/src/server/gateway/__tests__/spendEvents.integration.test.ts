/**
 * Integration tests for the gateway spend events billing table against real
 * ClickHouse: idempotent insert (at-least-once reactor delivery must not
 * duplicate), replacement-aware reads, and the multi-request debit probe on
 * the budget ledger next door.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import {
  GatewayBudgetClickHouseRepository,
  type BudgetDebitRow,
} from "../budget.clickhouse.repository";
import {
  GatewaySpendEventsRepository,
  type SpendEventRow,
} from "../spendEvents.clickhouse.repository";

const tenantId = `test-spend-events-${nanoid()}`;
const baseTime = Date.UTC(2026, 0, 15, 12, 0, 0);

let client: ClickHouseClient;
let repo: GatewaySpendEventsRepository;
let budgetRepo: GatewayBudgetClickHouseRepository;

beforeAll(async () => {
  const containers = await startTestContainers();
  client = containers.clickHouseClient;
  const resolve = async () => client;
  repo = new GatewaySpendEventsRepository(resolve);
  budgetRepo = new GatewayBudgetClickHouseRepository(resolve);
}, 120_000);

afterAll(async () => {
  // Scoped cleanup: this suite's tenant only, and only when it was assigned.
  if (client && tenantId) {
    await client.command({
      query: `ALTER TABLE gateway_spend_events DELETE WHERE TenantId = '${tenantId}'`,
    });
    await client.command({
      query: `ALTER TABLE gateway_budget_ledger_events DELETE WHERE TenantId = '${tenantId}'`,
    });
  }
  await stopTestContainers();
});

function spendRow(
  requestId: string,
  overrides: Partial<SpendEventRow> = {},
): SpendEventRow {
  return {
    tenantId,
    gatewayRequestId: requestId,
    organizationId: "org-1",
    teamId: "team-1",
    virtualKeyId: "vk-1",
    principalUserId: "",
    endUserId: "",
    traceId: "trace-1",
    model: "openai/gpt-5-mini",
    providerKey: "",
    tokensInput: 100,
    tokensOutput: 20,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    tokensReasoning: 0,
    costUsd: "0.004200",
    status: "success",
    errorClass: "",
    httpStatus: 0,
    labels: ["customer:acme-172"],
    metadata: "",
    durationMs: 250,
    occurredAt: new Date(baseTime),
    ...overrides,
  };
}

describe("gateway spend events table", () => {
  describe("idempotent insert", () => {
    /** @scenario Re-folding a trace does not duplicate spend records */
    it("a second insert of the same request id writes nothing", async () => {
      const requestId = `req-${nanoid()}`;
      const first = await repo.insertSpendEvents([spendRow(requestId)]);
      const second = await repo.insertSpendEvents([
        spendRow(requestId, { costUsd: "9.999999" }),
      ]);

      expect(first).toBe(1);
      expect(second).toBe(0);

      const rows = await repo.readSpendEvents({
        tenantId,
        fromMs: baseTime - 1000,
        toMs: baseTime + 1000,
      });
      const mine = rows.filter((r) => r.gatewayRequestId === requestId);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.costUsd).toBe("0.0042");
    });

    it("mixed batches only write the unseen request ids", async () => {
      const seen = `req-${nanoid()}`;
      const fresh = `req-${nanoid()}`;
      await repo.insertSpendEvents([spendRow(seen)]);
      const written = await repo.insertSpendEvents([
        spendRow(seen),
        spendRow(fresh),
      ]);
      expect(written).toBe(1);
    });
  });

  describe("replacement-aware reads", () => {
    /** @scenario Spend reads are replacement-aware */
    it("returns one row per request even with unmerged replacements on disk", async () => {
      const requestId = `req-${nanoid()}`;
      // Two direct inserts bypassing the probe simulate the RMT's
      // pre-merge state with two versions of one row on disk.
      const raw = {
        TenantId: tenantId,
        GatewayRequestId: requestId,
        OrganizationId: "org-1",
        TeamId: "team-1",
        VirtualKeyId: "vk-1",
        PrincipalUserId: "",
        EndUserId: "",
        TraceId: "trace-1",
        Model: "openai/gpt-5-mini",
        ProviderKey: "",
        TokensInput: 100,
        TokensOutput: 20,
        TokensCacheRead: 0,
        TokensCacheWrite: 0,
        TokensReasoning: 0,
        CostUSD: "0.004200",
        Status: "success",
        ErrorClass: "",
        HttpStatus: 0,
        Labels: [],
        Metadata: "",
        DurationMS: 250,
        OccurredAt: baseTime,
      };
      await client.insert({
        table: "gateway_spend_events",
        values: [
          { ...raw, EventTimestamp: 1 },
          { ...raw, EventTimestamp: 2, CostUSD: "0.005000" },
        ],
        format: "JSONEachRow",
      });

      const rows = await repo.readSpendEvents({
        tenantId,
        fromMs: baseTime - 1000,
        toMs: baseTime + 1000,
      });
      const mine = rows.filter((r) => r.gatewayRequestId === requestId);
      expect(mine).toHaveLength(1);
      // FINAL keeps the latest replacement version.
      expect(mine[0]!.costUsd).toBe("0.005");
    });
  });

  describe("token classes and error fields round-trip", () => {
    it("stores cache classes, provider id, error class and http status", async () => {
      const requestId = `req-${nanoid()}`;
      await repo.insertSpendEvents([
        spendRow(requestId, {
          tokensCacheRead: 20540,
          tokensCacheWrite: 22994,
          tokensReasoning: 12,
          providerKey: "mp-9",
          status: "error",
          errorClass: "provider_timeout",
          httpStatus: 504,
        }),
      ]);

      const rows = await repo.readSpendEvents({
        tenantId,
        fromMs: baseTime - 1000,
        toMs: baseTime + 1000,
      });
      const mine = rows.find((r) => r.gatewayRequestId === requestId);
      expect(mine).toMatchObject({
        tokensCacheRead: 20540,
        tokensCacheWrite: 22994,
        tokensReasoning: 12,
        providerKey: "mp-9",
        status: "error",
        errorClass: "provider_timeout",
        httpStatus: 504,
        labels: ["customer:acme-172"],
      });
    });
  });
});

describe("budget ledger multi-request insert", () => {
  function debitRow(
    requestId: string,
    budgetId: string,
    overrides: Partial<BudgetDebitRow> = {},
  ): BudgetDebitRow {
    return {
      tenantId,
      budgetId,
      scope: "PROJECT",
      scopeId: "project-1",
      window: "MONTH",
      virtualKeyId: "vk-1",
      gatewayRequestId: requestId,
      amountUsd: "0.0010000000",
      tokensInput: 100,
      tokensOutput: 20,
      tokensCacheRead: 20540,
      tokensCacheWrite: 22994,
      model: "openai/gpt-5-mini",
      durationMs: 100,
      status: "SUCCESS",
      occurredAt: new Date(baseTime),
      ...overrides,
    };
  }

  it("writes several request ids in one call and skips already-seen ids on replay", async () => {
    const budgetId = `budget-${nanoid()}`;
    const reqA = `req-${nanoid()}`;
    const reqB = `req-${nanoid()}`;

    await budgetRepo.insertDebits([
      debitRow(reqA, budgetId),
      debitRow(reqB, budgetId),
    ]);
    // Replay of A plus a new C: only C may land again.
    const reqC = `req-${nanoid()}`;
    await budgetRepo.insertDebits([
      debitRow(reqA, budgetId, { amountUsd: "9.9999999999" }),
      debitRow(reqC, budgetId),
    ]);

    const result = await client.query({
      query: `SELECT GatewayRequestId, toString(sum(AmountUSD)) AS Total FROM gateway_budget_ledger_events WHERE TenantId = {tenantId:String} AND BudgetId = {budgetId:String} GROUP BY GatewayRequestId ORDER BY GatewayRequestId`,
      query_params: { tenantId, budgetId },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{
      GatewayRequestId: string;
      Total: string;
    }>;
    expect(rows).toHaveLength(3);
    const byId = new Map(rows.map((r) => [r.GatewayRequestId, r.Total]));
    // The replayed A kept its original amount: the probe refused the rewrite.
    expect(Number(byId.get(reqA))).toBeCloseTo(0.001, 6);
    expect(Number(byId.get(reqC))).toBeCloseTo(0.001, 6);
  });
});
