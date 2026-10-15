/** @vitest-environment node */

/**
 * Gateway lookups by request id alone against a migrated ClickHouse (goose 00118): found
 * through the index, bounded to its range, reaching fewer parts than an unbounded read.
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  type ClickHouseQueryClient,
  type InsertRequest,
  type QueryRequest,
  setWindowedReadMetrics,
  type WindowedReadOutcome,
} from "@langwatch/clickhouse-client";
import {
  idIndexedClientDouble,
  migrateTestClickHouseOnce,
  partsAfterPartitionPruning,
  readyIdIndexedClientDouble,
  type ScriptedStatements,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { nowInstant } from "@langwatch/time";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GATEWAY_SPEND_PROJECTION_VERSION_LATEST } from "../../../rules/gateway-spend-projection.rules.ts";
import { GatewayBudgetClickHouseRepository } from "../clickhouse.gateway-budget.repository.ts";
import { GATEWAY_ID_INDEXES } from "../clickhouse.gateway-id-indexes.database.ts";
import { ClickHouseGatewaySession } from "../clickhouse.gateway-session.store.ts";
import { ClickHouseGatewaySpendEventsRepository } from "../clickhouse.gateway-spend-events.repository.ts";
const DAY_MS = 86_400_000;
const tenantId = `id-index-${Math.random().toString(36).slice(2, 10)}`;
const eightWeeksAgoMs = nowInstant().epochMilliseconds - 56 * DAY_MS;
// Each decoy partition holds ids on both sides of "req-old", in one part, so the planner
// cannot rule that part out by key and an unbounded read must open it.
const decoyAgesInDays = [100, 200];
const decoyIds = ["!decoy", "~decoy"];

let ch: ClickHouseClient;
let statements: QueryRequest[] = [];
let outcomes: { table: string; outcome: WindowedReadOutcome }[] = [];
/** The indexes read as filled, and as not filled: the same server, with and without the bound. */
let clickhouse: ClickHouseQueryClient;
/** The spend repository over the not-ready client: the read as it ran before the index. */
let unboundedSpend: ClickHouseGatewaySpendEventsRepository;
let unready: ClickHouseQueryClient;
let spend: ClickHouseGatewaySpendEventsRepository;
let ledger: GatewayBudgetClickHouseRepository;

/** A recording driver, so the test can run the exact source statement through the planner. */
function recordingDriver(client: ClickHouseClient): ScriptedStatements {
  return {
    async execute(request: QueryRequest) {
      statements.push(request);
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
      return { rows: await result.json() };
    },
    async insert(request: InsertRequest) {
      await client.insert({
        table: request.table,
        values: request.rows,
        format: "JSONEachRow",
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
    },
  };
}

async function partsReached(request: QueryRequest): Promise<number> {
  const result = await ch.query({
    query: `EXPLAIN ESTIMATE ${request.sql}`,
    format: "JSONEachRow",
    ...(request.params === undefined ? {} : { query_params: request.params }),
  });
  const rows = await result.json<{ parts: number | string }>();
  return rows.reduce((total, row) => total + Number(row.parts), 0);
}

/** One query on the test server, its rows as JSONEachRow parses them. */
async function queryRows(query: string, params?: Record<string, unknown>): Promise<unknown[]> {
  const result = await ch.query({
    query,
    format: "JSONEachRow",
    ...(params === undefined ? {} : { query_params: params }),
  });
  return result.json();
}

function sourceReadOf(table: string): QueryRequest {
  const read = statements.find(
    (request) => request.sql.includes(`FROM ${table}`) && !request.sql.includes("_id_index"),
  );
  if (!read) throw new Error(`no source read of ${table} was sent`);
  return read;
}

function spendRow({ id, occurredAtMs }: { id: string; occurredAtMs: number }) {
  return {
    TenantId: tenantId,
    GatewayRequestId: id,
    OrganizationId: "org-1",
    VirtualKeyId: "vk-1",
    Model: "openai/gpt-5",
    Status: "confirmed",
    Version: GATEWAY_SPEND_PROJECTION_VERSION_LATEST,
    OccurredAt: occurredAtMs,
    CreatedAt: occurredAtMs,
    LastEventOccurredAt: occurredAtMs,
    EventTimestamp: occurredAtMs,
  };
}

beforeAll(async () => {
  const [endpoint] = await startTestClickHouseEndpoints({
    suite: "gateway-id-index",
    names: ["ledger"],
    environment: process.env,
  });
  if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for the id-index suite");
  await migrateTestClickHouseOnce({
    url: endpoint.url,
    migrate: async () => {
      const previousCluster = process.env.CLICKHOUSE_CLUSTER;
      delete process.env.CLICKHOUSE_CLUSTER;
      try {
        await ClickHouseMigrateTask.createFromConfig({
          config: { buildTime: false, sharedUrl: endpoint.url, privateEndpoints: [] },
        }).execute();
      } finally {
        if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
      }
    },
  });
  ch = createClient({
    url: endpoint.url,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
  clickhouse = await readyIdIndexedClientDouble({
    indexes: GATEWAY_ID_INDEXES,
    driver: recordingDriver(ch),
  });
  unready = idIndexedClientDouble({ indexes: GATEWAY_ID_INDEXES, driver: recordingDriver(ch) });
  const resolve = async (routed: string) =>
    ClickHouseGatewaySession.create({ clickhouse, tenantId: routed });
  spend = ClickHouseGatewaySpendEventsRepository.create(resolve);
  ledger = GatewayBudgetClickHouseRepository.create(resolve);
  const resolveUnready = async (routed: string) =>
    ClickHouseGatewaySession.create({ clickhouse: unready, tenantId: routed });
  unboundedSpend = ClickHouseGatewaySpendEventsRepository.create(resolveUnready);
  setWindowedReadMetrics({ record: (entry) => outcomes.push(entry) });

  const decoys = decoyAgesInDays.flatMap((days) =>
    decoyIds.map((id) =>
      spendRow({ id: `${id}-${days}`, occurredAtMs: Date.now() - days * DAY_MS }),
    ),
  );
  await ch.insert({
    table: "gateway_spend",
    format: "JSONEachRow",
    values: [spendRow({ id: "req-old", occurredAtMs: eightWeeksAgoMs }), ...decoys],
  });
  await ledger.insertDebit([
    {
      tenantId,
      budgetId: "budget-1",
      scope: "VIRTUAL_KEY",
      scopeId: "vk-1",
      window: "MONTH",
      virtualKeyId: "vk-1",
      gatewayRequestId: "req-old",
      amountNanoUsd: 1_000,
      tokensInput: 1,
      tokensOutput: 1,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      model: "gpt-x",
      status: "SUCCESS",
      occurredAt: nowInstant().subtract({
        milliseconds: nowInstant().epochMilliseconds - eightWeeksAgoMs,
      }),
    },
  ]);
}, 180_000);

beforeEach(() => {
  statements = [];
  outcomes = [];
});

afterAll(async () => {
  if (!ch) return;
  for (const name of [
    "gateway_spend",
    "gateway_spend_id_index",
    "gateway_budget_ledger_events",
    "gateway_budget_ledger_events_id_index",
  ]) {
    await ch.exec({
      query: `ALTER TABLE ${name} DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
  await ch.close();
});

describe("gateway lookups by request id with the id index", () => {
  describe("given a request written eight weeks ago", () => {
    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("reads it back for the fold inside the index's range", async () => {
      const found = await spend.findForFold({
        tenantId,
        gatewayRequestId: "req-old",
      });

      expect(found).not.toBeNull();
      expect(outcomes).toContainEqual({ table: "gateway_spend", outcome: "index_hit" });
      const bounded = sourceReadOf("gateway_spend");
      expect(bounded.params).toMatchObject({
        idBound_fromMs: eightWeeksAgoMs - DAY_MS,
        idBound_toMs: eightWeeksAgoMs + DAY_MS,
      });
      statements = [];
      await unboundedSpend.findForFold({ tenantId, gatewayRequestId: "req-old" });
      expect(await partsReached(bounded)).toBeLessThan(
        await partsReached(sourceReadOf("gateway_spend")),
      );
    });

    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("finds it across tenants inside the index's range", async () => {
      const row = await spend.findSpendEventAcrossTenants({
        tenantIds: [tenantId],
        gatewayRequestId: "req-old",
        statuses: ["confirmed"],
      });

      expect(row?.gatewayRequestId).toBe("req-old");
      const bounded = sourceReadOf("gateway_spend");
      expect(bounded.params).toMatchObject({ idBound_fromMs: eightWeeksAgoMs - DAY_MS });
      statements = [];
      await unboundedSpend.findSpendEventAcrossTenants({
        tenantIds: [tenantId],
        gatewayRequestId: "req-old",
        statuses: ["confirmed"],
      });
      expect(await partsAfterPartitionPruning({ query: queryRows, request: bounded })).toBeLessThan(
        await partsAfterPartitionPruning({
          query: queryRows,
          request: sourceReadOf("gateway_spend"),
        }),
      );
    });

    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("bounds the ledger's replay probe to the index's range", async () => {
      await ledger.insertDebit([
        {
          tenantId,
          budgetId: "budget-1",
          scope: "VIRTUAL_KEY",
          scopeId: "vk-1",
          window: "MONTH",
          virtualKeyId: "vk-1",
          gatewayRequestId: "req-old",
          amountNanoUsd: 1_000,
          tokensInput: 1,
          tokensOutput: 1,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          model: "gpt-x",
          status: "SUCCESS",
          occurredAt: nowInstant(),
        },
      ]);

      expect(statements.some((request) => request.sql.includes("_id_index"))).toBe(true);
      const probe = statements.find(
        (request) =>
          request.sql.includes("FROM gateway_budget_ledger_events") &&
          !request.sql.includes("_id_index"),
      );
      expect(probe?.params).toHaveProperty("idBound_fromMs");
    });
  });
});
