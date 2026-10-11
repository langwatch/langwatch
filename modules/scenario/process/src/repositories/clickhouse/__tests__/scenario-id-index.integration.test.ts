/** @vitest-environment node */

/**
 * Scenario lookups by id alone against the migrated ClickHouse (goose 00115): found through
 * the index, bounded to its range, reaching fewer parts than an unbounded read.
 * Needs LANGWATCH_TEST_CLICKHOUSE_URL; the suite migrates a database of its own.
 */
import { randomUUID } from "node:crypto";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  ClickHouseQueryClient,
  type IdIndexFlags,
  type QueryDriver,
  type QueryRequest,
  setWindowedReadMetrics,
  TenantGuard,
  type WindowedReadOutcome,
} from "@langwatch/clickhouse-client";
import {
  migrateTestClickHouseOnce,
  nativeClickHouseBaseUrl,
  startTestClickHouseEndpoints,
  partsAfterPartitionPruning,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { createTenantId } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ClickHouseScenarioSession } from "../clickhouse.scenario-session.store.ts";
import { ClickHouseSimulationRunStateRepository } from "../clickhouse.simulation-run-state.repository.ts";
import { ClickHouseSimulationSession } from "../clickhouse.simulation-session.store.ts";
import { SimulationClickHouseRepository } from "../simulation-clickhouse.repository.ts";

const clickHouseConfigured = Boolean(nativeClickHouseBaseUrl(process.env));

const DAY_MS = 86_400_000;
const ON: IdIndexFlags = { isOn: () => true };

const tenantId = `${randomUUID()}-scenario-id-index`;
const now = nowInstant().epochMilliseconds;
const eightWeeksAgoMs = now - 56 * DAY_MS;
// Each decoy partition holds ids on both sides of every real id, in one part, so the planner
// cannot rule that part out by key and an unbounded read must open it.
const decoyAgesInDays = [100, 200];
const decoyIds = ["!decoy", "~decoy"];

let ch: ClickHouseClient;
let statements: QueryRequest[] = [];
let outcomes: { table: string; outcome: WindowedReadOutcome }[] = [];
let clickhouse: ClickHouseQueryClient;

/** A recording driver, so the test can run the exact source statement through the planner. */
function recordingClient(client: ClickHouseClient): ClickHouseQueryClient {
  const driver: QueryDriver = {
    async execute(request) {
      statements.push(request);
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
      return { rows: await result.json() };
    },
    async insert(request) {
      await client.insert({
        table: request.table,
        values: request.rows,
        format: "JSONEachRow",
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
    },
    async command(request) {
      await client.command({
        query: request.sql,
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
    },
  };
  return new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
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

const scenarioRunId = `${tenantId}-run`;

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  const [endpoint] = await startTestClickHouseEndpoints({
    suite: "scenario-id-index",
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
  clickhouse = recordingClient(ch);
  setWindowedReadMetrics({ record: (entry) => outcomes.push(entry) });

  const groups = [
    [{ id: scenarioRunId, atMs: eightWeeksAgoMs }],
    ...decoyAgesInDays.map((days) =>
      decoyIds.map((decoy) => ({ id: `${decoy}-${days}`, atMs: now - days * DAY_MS })),
    ),
  ];
  for (const group of groups) {
    await ch.insert({
      table: "simulation_runs",
      format: "JSONEachRow",
      values: group.map(({ id, atMs }) => ({
        ProjectionId: `${id}-projection`,
        TenantId: tenantId,
        ScenarioRunId: id,
        ScenarioId: `${id}-scenario`,
        BatchRunId: `${id}-batch`,
        ScenarioSetId: `${id}-set`,
        Version: "1",
        Status: "SUCCESS",
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
  for (const name of ["simulation_runs", "simulation_runs_id_index"]) {
    await ch.exec({
      query: `ALTER TABLE ${name} DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
  await ch.close();
});

describe.skipIf(!clickHouseConfigured)("scenario lookups by id with the id index", () => {
  describe("given a simulation run written eight weeks ago", () => {
    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("reads the run's data by id alone inside the index's range", async () => {
      const repository = SimulationClickHouseRepository.create(
        ClickHouseScenarioSession.resolverOver(clickhouse),
      );

      const found = await repository.findScenarioRunData({
        projectId: tenantId,
        scenarioRunId,
        idIndex: ON,
      });

      expect(found?.scenarioRunId).toBe(scenarioRunId);
      expect(outcomes).toContainEqual({ table: "simulation_runs", outcome: "index_hit" });
      const bounded = sourceReadOf("simulation_runs");
      expect(bounded.params).toMatchObject({
        fromMs: eightWeeksAgoMs - DAY_MS,
        toMs: eightWeeksAgoMs + DAY_MS,
      });
      statements = [];
      await repository.findScenarioRunData({ projectId: tenantId, scenarioRunId });
      expect(await partsAfterPartitionPruning({ query: queryRows, request: bounded })).toBeLessThan(
        await partsAfterPartitionPruning({
          query: queryRows,
          request: sourceReadOf("simulation_runs"),
        }),
      );
    });

    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("reads the run's fold state inside the index's range", async () => {
      const repository = ClickHouseSimulationRunStateRepository.create({
        resolveClient: ClickHouseSimulationSession.resolver(clickhouse),
        defaultRetentionDays: () => 308,
        idIndex: ON,
      });

      const projection = await repository.findProjection(scenarioRunId, {
        tenantId: createTenantId(tenantId),
      });

      expect(projection?.data).toMatchObject({ ScenarioRunId: scenarioRunId });
      expect(outcomes).toContainEqual({ table: "simulation_runs", outcome: "index_hit" });
      const bounded = sourceReadOf("simulation_runs");
      expect(bounded.params).toMatchObject({
        fromMs: eightWeeksAgoMs - DAY_MS,
        toMs: eightWeeksAgoMs + DAY_MS,
      });
      statements = [];
      await ClickHouseSimulationRunStateRepository.create({
        resolveClient: ClickHouseSimulationSession.resolver(clickhouse),
        defaultRetentionDays: () => 308,
      }).findProjection(scenarioRunId, { tenantId: createTenantId(tenantId) });
      expect(await partsAfterPartitionPruning({ query: queryRows, request: bounded })).toBeLessThan(
        await partsAfterPartitionPruning({
          query: queryRows,
          request: sourceReadOf("simulation_runs"),
        }),
      );
    });
  });
});
