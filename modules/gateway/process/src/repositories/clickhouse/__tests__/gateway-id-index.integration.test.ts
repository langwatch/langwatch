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
import {
  createTenantId,
  type Event,
  EventUtils,
  type FoldProjectionStore,
} from "@langwatch/eventing";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
} from "@langwatch/gateway-contract";
import {
  GATEWAY_SPEND_AGGREGATE_TYPE,
  GATEWAY_SPEND_EVENT_VERSION_LATEST,
  type GatewaySpendAdmittedEvent,
  type GatewaySpendConfirmedEvent,
} from "@langwatch/gateway-process";
import { nowInstant, Temporal, toDate } from "@langwatch/time";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  GatewaySpendFoldProjection,
  type GatewaySpendState,
} from "../../../eventing/gateway-spend.projection.ts";
import {
  EMPTY_SPEND_USAGE,
  GATEWAY_SPEND_PROJECTION_VERSION_LATEST,
} from "../../../rules/gateway-spend-projection.rules.ts";
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
// Admitted 100 ms before a month starts and confirmed 500 ms after; the confirmation folds first.
const RACED = "req-raced";
const racedMonthStart = Temporal.Instant.fromEpochMilliseconds(eightWeeksAgoMs)
  .toZonedDateTimeISO("UTC")
  .with({ day: 1 })
  .startOfDay();
const racedRequestAtMs = racedMonthStart.epochMilliseconds - 100;
const racedOutcomeAtMs = racedMonthStart.epochMilliseconds + 500;
const racedPartition = (() => {
  const month = Temporal.Instant.fromEpochMilliseconds(racedRequestAtMs).toZonedDateTimeISO("UTC");
  return `${month.year}${String(month.month).padStart(2, "0")}`;
})();

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

/**
 * The parts left once the time bound has pruned partitions (EXPLAIN's Partition stage). Not
 * EXPLAIN ESTIMATE: from 26.4 that also counts column-statistics pruning, which can narrow an
 * unbounded read to the same part and hide what the bound saves.
 */
async function partsReached(request: QueryRequest): Promise<number> {
  return partsAfterPartitionPruning({ query: queryRows, request });
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
    // A Date, as the fold writes it: 26.8 reads an unquoted integer here as seconds (#108091).
    OccurredAt: toDate(Temporal.Instant.fromEpochMilliseconds(occurredAtMs)),
    CreatedAt: occurredAtMs,
    LastEventOccurredAt: occurredAtMs,
    EventTimestamp: occurredAtMs,
  };
}

function racedEvent<E extends Event>(type: E["type"], data: E["data"], occurredAt: number): E {
  return EventUtils.createEvent<E>({
    aggregateType: GATEWAY_SPEND_AGGREGATE_TYPE,
    aggregateId: RACED,
    tenantId: createTenantId(tenantId),
    type,
    version: GATEWAY_SPEND_EVENT_VERSION_LATEST,
    data,
    occurredAt,
    idempotencyKey: `${tenantId}:${RACED}:${type}`,
  });
}

/**
 * The fold's two versions of the raced request, each committed in its own batch through the
 * store's writer: the confirmation (naming its admission instant) first, the admission after.
 */
async function foldRacedRequest(): Promise<void> {
  const attribution = {
    organization_id: "org-1",
    virtual_key_id: "vk-1",
    principal_user_id: "",
    end_user_id: "",
    trace_id: "",
    request_type: "chat",
    labels: [],
    metadata: "",
  };
  const confirmation = racedEvent<GatewaySpendConfirmedEvent>(
    GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
    {
      ...attribution,
      gateway_request_id: RACED,
      occurred_at: racedOutcomeAtMs,
      tenantId,
      model: "openai/gpt-5",
      model_provider_id: "mp-1",
      usage: { ...EMPTY_SPEND_USAGE, input_tokens: 10, output_tokens: 5 },
      cost_nano_usd: 2_000,
      rate_version: "catalog@test",
      duration_ms: 600,
      admitted_at: racedRequestAtMs,
      team_id: "",
    },
    racedOutcomeAtMs,
  );
  const admission = racedEvent<GatewaySpendAdmittedEvent>(
    GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
    {
      ...attribution,
      outcome_carries_attribution: true,
      gateway_request_id: RACED,
      occurred_at: racedRequestAtMs,
      tenantId,
      model: "openai/gpt-5",
      model_provider_id: "mp-1",
      team_id: "",
      pod_id: "pod-1",
      pod_seq: 1,
    },
    racedRequestAtMs,
  );
  const projection = new GatewaySpendFoldProjection({
    store: {} as FoldProjectionStore<GatewaySpendState>,
  });
  const fresh = projection.handleGatewaySpendConfirmed(confirmation, {
    status: "",
    organizationId: "",
    virtualKeyId: "",
    principalUserId: "",
    endUserId: "",
    model: "",
    providerKey: "",
    traceId: "",
    requestType: "",
    labels: [],
    metadataJson: "",
    podId: "",
    podSeq: 0,
    usage: null,
    rateVersion: "",
    costNanoUsd: 0,
    errorType: "",
    httpStatus: 0,
    needsReconciliation: false,
    settleReason: "",
    occurredAtMs: 0,
    durationMs: 0,
    createdAt: racedOutcomeAtMs,
    updatedAt: racedOutcomeAtMs,
    LastEventOccurredAt: racedOutcomeAtMs,
  });
  await spend.upsertFromFold([{ tenantId, gatewayRequestId: RACED, state: fresh }]);
  const late = projection.handleGatewaySpendAdmitted(admission, fresh);
  await spend.upsertFromFold([
    { tenantId, gatewayRequestId: RACED, state: { ...late, updatedAt: racedOutcomeAtMs + 1_000 } },
  ]);
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
  await foldRacedRequest();
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

  describe("given a request whose confirmation folded before its admission across a month", () => {
    /** @scenario A request folded out of order across a month boundary is found in one partition */
    it("keeps every version in the request's month and reads the same row with fewer parts", async () => {
      const placement = await queryRows(
        `SELECT toString(uniqExact(_partition_id)) AS partitions, any(_partition_id) AS partition
         FROM gateway_spend WHERE TenantId = {tenantId:String} AND GatewayRequestId = {id:String}`,
        { tenantId, id: RACED },
      );
      expect(placement).toEqual([{ partitions: "1", partition: racedPartition }]);

      const bounded = await spend.findForFold({ tenantId, gatewayRequestId: RACED });
      const boundedRead = sourceReadOf("gateway_spend");
      statements = [];
      const unbounded = await unboundedSpend.findForFold({ tenantId, gatewayRequestId: RACED });

      expect(bounded).toEqual(unbounded);
      expect(bounded).toMatchObject({
        status: "confirmed",
        organizationId: "org-1",
        costNanoUsd: 2_000,
        occurredAtMs: racedRequestAtMs,
      });
      expect(await partsReached(boundedRead)).toBeLessThan(
        await partsReached(sourceReadOf("gateway_spend")),
      );
    });
  });
});
