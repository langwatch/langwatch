/** @vitest-environment node */

/**
 * Suite lookups by id alone against the migrated ClickHouse (goose 00116): found through
 * the index, bounded to its range, reaching fewer parts than an unbounded read.
 * A native ClickHouse when LANGWATCH_TEST_CLICKHOUSE_URL is set, else a container; own database.
 */
import { randomUUID } from "node:crypto";

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
  readyIdIndexedClientDouble,
  type ScriptedStatements,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { createTenantId } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SUITE_ID_INDEXES } from "../clickhouse.suite-id-indexes.database.ts";
import { ClickHouseSuiteRunRepository } from "../clickhouse.suite-run.repository.ts";

const DAY_MS = 86_400_000;

const tenantId = `${randomUUID()}-suite-id-index`;
const now = nowInstant().epochMilliseconds;
const eightWeeksAgoMs = now - 56 * DAY_MS;
// Each decoy partition holds ids on both sides of every real id, in one part, so the planner
// cannot rule that part out by key and an unbounded read must open it.
const decoyAgesInDays = [100, 200];
const decoyIds = ["!decoy", "~decoy"];

let ch: ClickHouseClient;
let statements: QueryRequest[] = [];
let outcomes: { table: string; outcome: WindowedReadOutcome }[] = [];
/** The indexes read as filled, and as not filled: the same server, with and without the bound. */
let clickhouse: ClickHouseQueryClient;
let unready: ClickHouseQueryClient;

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

/** The parts the planner reaches for one statement, summed over the tables it names. */
async function partsReached(request: QueryRequest): Promise<number> {
  const result = await ch.query({
    query: `EXPLAIN ESTIMATE ${request.sql}`,
    format: "JSONEachRow",
    ...(request.params === undefined ? {} : { query_params: request.params }),
  });
  const rows = await result.json<{ parts: number | string }>();
  return rows.reduce((total, row) => total + Number(row.parts), 0);
}

/** The one statement that read `table`'s source rows, not its index. */
function sourceReadOf(table: string): QueryRequest {
  const read = statements.find(
    (request) => request.sql.includes(`FROM ${table}`) && !request.sql.includes("_id_index"),
  );
  if (!read) throw new Error(`no source read of ${table} was sent`);
  return read;
}

const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(() => {
  statements = [];
  outcomes = [];
});

const batchRunId = `${tenantId}-batch`;

beforeAll(async () => {
  const [endpoint] = await startTestClickHouseEndpoints({
    suite: "suite-id-index",
    names: ["schema"],
    environment: process.env,
  });
  if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for the id-index suite");
  await migrateTestClickHouseOnce({
    url: endpoint.url,
    migrate: async () => {
      // CLICKHOUSE_CLUSTER switches every engine to its Replicated form, which needs a Keeper.
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
    indexes: SUITE_ID_INDEXES,
    driver: recordingDriver(ch),
  });
  unready = idIndexedClientDouble({ indexes: SUITE_ID_INDEXES, driver: recordingDriver(ch) });
  setWindowedReadMetrics({ record: (entry) => outcomes.push(entry) });

  const groups = [
    [{ id: batchRunId, atMs: eightWeeksAgoMs }],
    ...decoyAgesInDays.map((days) =>
      decoyIds.map((decoy) => ({ id: `${decoy}-${days}`, atMs: now - days * DAY_MS })),
    ),
  ];
  for (const group of groups) {
    await ch.insert({
      table: "suite_runs",
      format: "JSONEachRow",
      values: group.map(({ id, atMs }) => ({
        ProjectionId: `${id}-projection`,
        TenantId: tenantId,
        SuiteRunId: `${id}-suite-run`,
        BatchRunId: id,
        ScenarioSetId: `${id}-set`,
        SuiteId: `${id}-suite`,
        Version: "1",
        Status: "COMPLETED",
        Total: 1,
        CreatedAt: iso(atMs),
        UpdatedAt: iso(atMs),
        StartedAt: iso(atMs),
        _retention_days: 308,
      })),
    });
  }
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  for (const name of ["suite_runs", "suite_runs_id_index"]) {
    await ch.exec({
      query: `ALTER TABLE ${name} DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
  await ch.close();
});

describe("suite lookups by id with the id index", () => {
  describe("given a suite run written eight weeks ago", () => {
    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("reads the run's fold state by batch run id alone inside the index's range", async () => {
      const repository = ClickHouseSuiteRunRepository.create({
        clickhouse,
        defaultRetentionDays: () => 308,
      });

      const projection = await repository.findProjection(batchRunId, {
        tenantId: createTenantId(tenantId),
      });

      expect(projection?.data.BatchRunId).toBe(batchRunId);
      expect(outcomes).toContainEqual({ table: "suite_runs", outcome: "index_hit" });
      const bounded = sourceReadOf("suite_runs");
      expect(bounded.params).toMatchObject({
        idBound_fromMs: eightWeeksAgoMs - DAY_MS,
        idBound_toMs: eightWeeksAgoMs + DAY_MS,
      });
      statements = [];
      await ClickHouseSuiteRunRepository.create({
        clickhouse: unready,
        defaultRetentionDays: () => 308,
      }).findProjection(batchRunId, { tenantId: createTenantId(tenantId) });
      expect(await partsReached(bounded)).toBeLessThan(
        await partsReached(sourceReadOf("suite_runs")),
      );
    });
  });
});
