import type { IdIndexBounds, IdIndexFlags, IdIndexReader } from "@langwatch/clickhouse-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { BudgetDebitRow } from "../../gateway-budget-spend.repository.ts";
import { GatewayBudgetClickHouseRepository } from "../clickhouse.gateway-budget.repository.ts";
import type { GatewayClickHouseClient } from "../clickhouse.gateway-session.store.ts";
import { ClickHouseGatewaySpendEventsRepository } from "../clickhouse.gateway-spend-events.repository.ts";

const DAY_MS = 86_400_000;
const FROM_MS = Date.parse("2026-08-03T10:00:00Z");
const TO_MS = Date.parse("2026-08-05T10:00:00Z");
const ON: IdIndexFlags = { isOn: () => true };
const OFF: IdIndexFlags = { isOn: () => false };

type SentQuery = Parameters<GatewayClickHouseClient["query"]>[0];

/** A client that answers every query with `rows` and records what was sent and inserted. */
function clientAnswering(rows: readonly Record<string, unknown>[]) {
  const queries: SentQuery[] = [];
  const inserts: unknown[] = [];
  const client = createApiFixture<GatewayClickHouseClient>({
    query: async (input) => {
      queries.push(input);
      return { json: <T>(): Promise<T[]> => Promise.resolve(JSON.parse(JSON.stringify(rows))) };
    },
    insert: async (input) => {
      inserts.push(input);
    },
  });
  return { client, queries, inserts };
}

/** An id index that holds `n` rows for any request, spanning the fixture range. */
function indexHolding(n: number): IdIndexReader & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    targetOf: async () => "shared",
    indexBounds: async ({ index }): Promise<IdIndexBounds> => {
      reads.push(index);
      return { n, fromMs: FROM_MS, toMs: TO_MS };
    },
  };
}

const spendRepository = (
  client: GatewayClickHouseClient,
  idIndexReader: IdIndexReader | undefined,
) => ClickHouseGatewaySpendEventsRepository.create(async () => client, { idIndexReader });

const budgetRepository = (
  client: GatewayClickHouseClient,
  idIndexReader: IdIndexReader | undefined,
) => GatewayBudgetClickHouseRepository.create(async () => client, { idIndexReader });

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
    it("bounds the read to the index range, a day each side, once the flag is on", async () => {
      const { client, queries } = clientAnswering([]);
      const reader = indexHolding(1);

      await spendRepository(client, reader).findForFold({
        tenantId: "project-1",
        gatewayRequestId: "req-1",
        idIndex: ON,
      });

      expect(reader.reads).toEqual(["gateway_spend_id_index"]);
      expect(queries).toHaveLength(1);
      expect(queries[0]?.query).toContain("OccurredAt >= fromUnixTimestamp64Milli");
      expect(queries[0]?.query_params).toMatchObject({
        fromMs: FROM_MS - DAY_MS,
        toMs: TO_MS + DAY_MS,
      });
    });

    it("reads as before while the flag is off, with no index read and no bound", async () => {
      const { client, queries } = clientAnswering([]);
      const reader = indexHolding(1);

      await spendRepository(client, reader).findForFold({
        tenantId: "project-1",
        gatewayRequestId: "req-1",
        idIndex: OFF,
      });

      expect(reader.reads).toEqual([]);
      expect(queries[0]?.query).not.toContain("OccurredAt >=");
    });

    it("reads as before when no index reader was given", async () => {
      const { client, queries } = clientAnswering([]);

      await spendRepository(client, undefined).findForFold({
        tenantId: "project-1",
        gatewayRequestId: "req-1",
        idIndex: ON,
      });

      expect(queries[0]?.query).not.toContain("OccurredAt >=");
    });

    it("probes the recent weeks once for a request the index has never seen", async () => {
      const { client, queries } = clientAnswering([]);

      await spendRepository(client, indexHolding(0)).findForFold({
        tenantId: "project-1",
        gatewayRequestId: "req-1",
        idIndex: ON,
      });

      expect(queries).toHaveLength(1);
      const params = queries[0]?.query_params ?? {};
      expect(Number(params.toMs) - Number(params.fromMs)).toBeLessThan(40 * DAY_MS);
    });
  });

  describe("given a spend event is found across tenants", () => {
    it("bounds each tenant's read to its own index range", async () => {
      const { client, queries } = clientAnswering([]);

      await spendRepository(client, indexHolding(1)).findSpendEventAcrossTenants({
        tenantIds: ["project-1", "project-2"],
        gatewayRequestId: "req-1",
        statuses: ["confirmed"],
        idIndex: ON,
      });

      expect(queries).toHaveLength(2);
      for (const query of queries) {
        expect(query.query).toContain("OccurredAt >= fromUnixTimestamp64Milli");
      }
    });
  });

  describe("given the ledger probes whether a request was already debited", () => {
    it("answers a replay from the index alone, without reading the ledger", async () => {
      const { client, queries, inserts } = clientAnswering([]);

      await budgetRepository(client, indexHolding(1)).insertDebit([debit()], { idIndex: ON });

      expect(queries).toHaveLength(0);
      expect(inserts).toHaveLength(0);
    });

    it("inserts a request the index has never seen, with no ledger probe at all", async () => {
      const { client, queries, inserts } = clientAnswering([]);

      await budgetRepository(client, indexHolding(0)).insertDebit([debit()], { idIndex: ON });

      expect(queries).toHaveLength(0);
      expect(inserts).toHaveLength(1);
    });

    it("probes the ledger as before while the flag is off", async () => {
      const { client, queries, inserts } = clientAnswering([{ "1": 1 }]);

      await budgetRepository(client, indexHolding(1)).insertDebit([debit()], { idIndex: OFF });

      expect(queries).toHaveLength(1);
      expect(queries[0]?.query).toContain("SELECT 1 FROM gateway_budget_ledger_events");
      expect(inserts).toHaveLength(0);
    });
  });

  describe("given the ledger probes the budgets already debited on a request", () => {
    it("skips the probe for a request the index has never seen", async () => {
      const { client, queries, inserts } = clientAnswering([]);

      await budgetRepository(client, indexHolding(0)).insertDebitsForBudgets([debit()], {
        idIndex: ON,
      });

      expect(queries).toHaveLength(0);
      expect(inserts).toHaveLength(1);
    });

    it("bounds the probe to the index range for a request it has seen", async () => {
      const { client, queries } = clientAnswering([{ BudgetId: "budget-1", ScopeId: "vk-1" }]);

      await budgetRepository(client, indexHolding(1)).insertDebitsForBudgets([debit()], {
        idIndex: ON,
      });

      expect(queries).toHaveLength(1);
      expect(queries[0]?.query).toContain("OccurredAt >= fromUnixTimestamp64Milli");
      expect(queries[0]?.query_params).toMatchObject({
        fromMs: FROM_MS - DAY_MS,
        toMs: TO_MS + DAY_MS,
      });
    });

    it("probes unbounded as before while the flag is off", async () => {
      const { client, queries } = clientAnswering([]);

      await budgetRepository(client, indexHolding(1)).insertDebitsForBudgets([debit()], {
        idIndex: OFF,
      });

      expect(queries[0]?.query).not.toContain("OccurredAt >=");
    });
  });
});
