/**
 * Gateway lookups by request id through the id index.
 * Spec: specs/clickhouse/id-index-reads.feature
 */
import {
  type InsertRequest,
  type QueryRequest,
  setWindowedReadMetrics,
  type WindowedReadOutcome,
} from "@langwatch/clickhouse-client";
import {
  idIndexedClientDouble,
  readyIdIndexedClientDouble,
} from "@langwatch/clickhouse-client/testing";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { BudgetDebitRow } from "../../gateway-budget-spend.repository.ts";
import { GatewayBudgetClickHouseRepository } from "../clickhouse.gateway-budget.repository.ts";
import { GATEWAY_ID_INDEXES } from "../clickhouse.gateway-id-indexes.database.ts";
import { ClickHouseGatewaySession } from "../clickhouse.gateway-session.store.ts";
import { ClickHouseGatewaySpendEventsRepository } from "../clickhouse.gateway-spend-events.repository.ts";

const DAY_MS = 86_400_000;
const FROM_MS = Date.parse("2026-08-03T10:00:00Z");
const TO_MS = Date.parse("2026-08-05T10:00:00Z");

/**
 * The gateway repositories over the routed client, its indexes declared: `index.n` index rows
 * per request, filled when `ready`. Every source statement answers `rows`; the index reads,
 * the source statements and the inserts are each recorded.
 */
async function gatewayOver({
  rows,
  index = { n: 1 },
  ready = true,
}: {
  rows: readonly Record<string, unknown>[];
  index?: { n: number };
  ready?: boolean;
}) {
  const queries: QueryRequest[] = [];
  const inserts: InsertRequest[] = [];
  const reads: string[] = [];
  const driver = {
    async execute(request: QueryRequest) {
      if (request.sql.includes("count() AS n")) {
        reads.push(request.table ?? "");
        return { rows: [{ n: index.n, fromMs: FROM_MS, toMs: TO_MS }] };
      }
      queries.push(request);
      return { rows };
    },
    async insert(request: InsertRequest) {
      inserts.push(request);
    },
  };
  const clickhouse = ready
    ? await readyIdIndexedClientDouble({ indexes: GATEWAY_ID_INDEXES, driver })
    : idIndexedClientDouble({ indexes: GATEWAY_ID_INDEXES, driver });
  const resolve = async (tenantId: string) =>
    ClickHouseGatewaySession.create({ clickhouse, tenantId });
  return {
    spend: ClickHouseGatewaySpendEventsRepository.create(resolve),
    budget: GatewayBudgetClickHouseRepository.create(resolve),
    queries,
    inserts,
    reads,
  };
}

const spanOf = (request: QueryRequest | undefined) =>
  Number(request?.params?.idBound_toMs) - Number(request?.params?.idBound_fromMs);

/** Collects the windowed read outcomes counted from here on. */
function recordOutcomes(): { table: string; outcome: WindowedReadOutcome }[] {
  const outcomes: { table: string; outcome: WindowedReadOutcome }[] = [];
  setWindowedReadMetrics({ record: (entry) => outcomes.push(entry) });
  return outcomes;
}

function debit(over: Partial<BudgetDebitRow> = {}): BudgetDebitRow {
  return {
    tenantId: "project-1",
    budgetId: "budget-1",
    scope: "VIRTUAL_KEY",
    scopeId: "vk-1",
    window: "MONTH",
    virtualKeyId: "vk-1",
    providerKey: null,
    gatewayRequestId: "req-1",
    amountNanoUsd: 1_000,
    tokensInput: 1,
    tokensOutput: 1,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    model: "gpt-x",
    durationMs: 1,
    status: "SUCCESS",
    occurredAt: nowInstant(),
    ...over,
  };
}

describe("gateway lookups by request id with the id index", () => {
  describe("given the fold reads a request back", () => {
    it("bounds the read to the index range, a day each side, once the index is ready", async () => {
      const gateway = await gatewayOver({ rows: [] });

      await gateway.spend.findForFold({ tenantId: "project-1", gatewayRequestId: "req-1" });

      expect(gateway.reads).toEqual(["gateway_spend_id_index"]);
      expect(gateway.queries).toHaveLength(1);
      expect(gateway.queries[0]?.sql).toContain("OccurredAt >= fromUnixTimestamp64Milli");
      expect(gateway.queries[0]?.params).toMatchObject({
        idBound_fromMs: FROM_MS - DAY_MS,
        idBound_toMs: TO_MS + DAY_MS,
      });
    });

    it("reads as before while the index is not ready, with no index read and no bound", async () => {
      const gateway = await gatewayOver({ rows: [], ready: false });

      await gateway.spend.findForFold({ tenantId: "project-1", gatewayRequestId: "req-1" });

      expect(gateway.reads).toEqual([]);
      expect(gateway.queries[0]?.sql).not.toContain("OccurredAt >=");
    });

    it("probes the recent weeks once for a request the index has never seen", async () => {
      const gateway = await gatewayOver({ rows: [], index: { n: 0 } });

      await gateway.spend.findForFold({ tenantId: "project-1", gatewayRequestId: "req-1" });

      expect(gateway.queries).toHaveLength(1);
      expect(spanOf(gateway.queries[0])).toBeLessThan(40 * DAY_MS);
    });
  });

  describe("given a spend event is found across tenants", () => {
    it("bounds each tenant's read to its own index range", async () => {
      const gateway = await gatewayOver({ rows: [] });

      await gateway.spend.findSpendEventAcrossTenants({
        tenantIds: ["project-1", "project-2"],
        gatewayRequestId: "req-1",
        statuses: ["confirmed"],
      });

      expect(gateway.queries).toHaveLength(2);
      for (const query of gateway.queries) {
        expect(query.sql).toContain("OccurredAt >= fromUnixTimestamp64Milli");
      }
    });
  });

  describe("given the ledger probes whether a request was already debited", () => {
    it("answers a replay from the index's range, without reading the whole ledger", async () => {
      const gateway = await gatewayOver({ rows: [{ "1": 1 }] });

      await gateway.budget.insertDebit([debit()]);

      expect(gateway.queries).toHaveLength(1);
      expect(gateway.queries[0]?.params).toMatchObject({ idBound_fromMs: FROM_MS - DAY_MS });
      expect(gateway.inserts).toHaveLength(0);
    });

    it("confirms a request the index has never seen against the recent ledger, then inserts", async () => {
      const gateway = await gatewayOver({ rows: [], index: { n: 0 } });

      await gateway.budget.insertDebit([debit()]);

      expect(gateway.queries).toHaveLength(1);
      expect(gateway.queries[0]?.sql).toContain("OccurredAt >= fromUnixTimestamp64Milli");
      expect(spanOf(gateway.queries[0])).toBeLessThan(40 * DAY_MS);
      expect(gateway.inserts).toHaveLength(1);
    });

    /** @scenario "a ledger replay is never taken for a new request on an index miss alone" */
    it("never inserts a replay whose index row went missing, and counts the found miss", async () => {
      const outcomes = recordOutcomes();
      const gateway = await gatewayOver({ rows: [{ "1": 1 }], index: { n: 0 } });

      await gateway.budget.insertDebit([debit()]);

      expect(gateway.inserts).toHaveLength(0);
      expect(outcomes).toEqual([
        { table: "gateway_budget_ledger_events", outcome: "index_miss_found" },
      ]);
    });

    it("probes the ledger as before while the index is not ready", async () => {
      const gateway = await gatewayOver({ rows: [{ "1": 1 }], ready: false });

      await gateway.budget.insertDebit([debit()]);

      expect(gateway.queries).toHaveLength(1);
      expect(gateway.queries[0]?.sql).toContain("SELECT 1 FROM gateway_budget_ledger_events");
      expect(gateway.inserts).toHaveLength(0);
    });
  });

  describe("given the ledger probes the budgets already debited on a request", () => {
    it("probes only the recent ledger for a request the index has never seen", async () => {
      const gateway = await gatewayOver({ rows: [], index: { n: 0 } });

      await gateway.budget.insertDebitsForBudgets([debit()]);

      expect(gateway.queries).toHaveLength(1);
      expect(spanOf(gateway.queries[0])).toBeLessThan(40 * DAY_MS);
      expect(gateway.inserts).toHaveLength(1);
    });

    /** @scenario "a ledger replay is never taken for a new request on an index miss alone" */
    it("skips a budget the recent ledger already holds despite an index miss", async () => {
      const outcomes = recordOutcomes();
      const gateway = await gatewayOver({
        rows: [{ BudgetId: "budget-1", ScopeId: "vk-1" }],
        index: { n: 0 },
      });

      await gateway.budget.insertDebitsForBudgets([debit()]);

      expect(gateway.inserts).toHaveLength(0);
      expect(outcomes.map((each) => each.outcome)).toEqual(["index_miss_found"]);
    });

    it("bounds the probe to the index range for a request it has seen", async () => {
      const gateway = await gatewayOver({ rows: [{ BudgetId: "budget-1", ScopeId: "vk-1" }] });

      await gateway.budget.insertDebitsForBudgets([debit()]);

      expect(gateway.queries).toHaveLength(1);
      expect(gateway.queries[0]?.sql).toContain("OccurredAt >= fromUnixTimestamp64Milli");
      expect(gateway.queries[0]?.params).toMatchObject({
        idBound_fromMs: FROM_MS - DAY_MS,
        idBound_toMs: TO_MS + DAY_MS,
      });
    });

    it("probes unbounded as before while the index is not ready", async () => {
      const gateway = await gatewayOver({ rows: [], ready: false });

      await gateway.budget.insertDebitsForBudgets([debit()]);

      expect(gateway.queries[0]?.sql).not.toContain("OccurredAt >=");
    });
  });
});
