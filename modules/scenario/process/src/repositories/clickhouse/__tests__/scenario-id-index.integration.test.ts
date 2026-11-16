/** @vitest-environment node */

/**
 * Scenario lookups by id alone against the migrated ClickHouse (goose 00115): found through
 * the index, bounded to its range, reaching fewer parts than an unbounded read.
 * Its own container with the app reader provisioned: reads as the reader, inserts as the system.
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import {
  type ClickHouseQueryClient,
  type InsertRequest,
  type QueryRequest,
  setWindowedReadMetrics,
  type WindowedReadOutcome,
} from "@langwatch/clickhouse-client";
import {
  idIndexedClientDouble,
  partsAfterPartitionPruning,
  readyIdIndexedClientDouble,
  type ScriptedStatements,
} from "@langwatch/clickhouse-client/testing";
import { createTenantId } from "@langwatch/eventing";
import {
  type MigratedAppReaderClickHouse,
  startMigratedAppReaderClickHouse,
} from "@langwatch/test-harness/clickhouse-app-reader";
import { nowInstant } from "@langwatch/time";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  SCENARIO_ID_INDEXES,
  SCENARIO_SECOND_ID_INDEXES,
} from "../clickhouse.scenario-id-indexes.database.ts";
import { ClickHouseScenarioSession } from "../clickhouse.scenario-session.store.ts";
import { ClickHouseSimulationRunStateRepository } from "../clickhouse.simulation-run-state.repository.ts";
import { ClickHouseSimulationSession } from "../clickhouse.simulation-session.store.ts";
import { SimulationClickHouseRepository } from "../simulation-clickhouse.repository.ts";

const DAY_MS = 86_400_000;

const tenantId = `${randomUUID()}-scenario-id-index`;
const now = nowInstant().epochMilliseconds;
const eightWeeksAgoMs = now - 56 * DAY_MS;
// Each decoy partition holds ids on both sides of every real id, in one part, so the planner
// cannot rule that part out by key and an unbounded read must open it.
const decoyAgesInDays = [100, 200];
const decoyIds = ["!decoy", "~decoy"];

let ch: ClickHouseClient;
let migrated: MigratedAppReaderClickHouse;
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
  migrated = await startMigratedAppReaderClickHouse({
    environment: process.env,
    suite: "scenario-id-index",
    indexes: [...SCENARIO_ID_INDEXES, ...SCENARIO_SECOND_ID_INDEXES],
  });
  ch = migrated.admin;
  clickhouse = await readyIdIndexedClientDouble({
    indexes: [...SCENARIO_ID_INDEXES, ...SCENARIO_SECOND_ID_INDEXES],
    driver: recordingDriver(ch),
    reader: recordingDriver(migrated.readerConnection),
  });
  unready = idIndexedClientDouble({
    indexes: [...SCENARIO_ID_INDEXES, ...SCENARIO_SECOND_ID_INDEXES],
    driver: recordingDriver(ch),
    reader: recordingDriver(migrated.readerConnection),
  });
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
  for (const name of [
    "simulation_runs",
    "simulation_runs_id_index",
    "simulation_runs_by_batch_run_id_index",
    "simulation_runs_by_scenario_set_id_index",
  ]) {
    await ch.exec({
      query: `ALTER TABLE ${name} DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
});

/** Scenario's simulation reads over one routing member: its sessions, and it for set reads. */
function repositoryOver(member: Parameters<typeof ClickHouseScenarioSession.resolverOver>[0]) {
  return SimulationClickHouseRepository.create({
    sessions: ClickHouseScenarioSession.resolverOver(member),
    clickhouse: member,
  });
}

describe("scenario lookups by id with the id index", () => {
  describe("given a simulation run written eight weeks ago", () => {
    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("reads the run's data by id alone inside the index's range", async () => {
      const repository = repositoryOver(clickhouse);

      const found = await repository.findScenarioRunData({
        projectId: tenantId,
        scenarioRunId,
      });

      expect(found?.scenarioRunId).toBe(scenarioRunId);
      expect(outcomes).toContainEqual({ table: "simulation_runs", outcome: "index_hit" });
      const bounded = sourceReadOf("simulation_runs");
      expect(bounded.params).toMatchObject({
        idBound_fromMs: eightWeeksAgoMs - DAY_MS,
        idBound_toMs: eightWeeksAgoMs + DAY_MS,
      });
      statements = [];
      await repositoryOver(unready).findScenarioRunData({ projectId: tenantId, scenarioRunId });
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
      });

      const projection = await repository.findProjection(scenarioRunId, {
        tenantId: createTenantId(tenantId),
      });

      expect(projection?.data).toMatchObject({ ScenarioRunId: scenarioRunId });
      expect(outcomes).toContainEqual({ table: "simulation_runs", outcome: "index_hit" });
      const bounded = sourceReadOf("simulation_runs");
      expect(bounded.params).toMatchObject({
        idBound_fromMs: eightWeeksAgoMs - DAY_MS,
        idBound_toMs: eightWeeksAgoMs + DAY_MS,
      });
      statements = [];
      await ClickHouseSimulationRunStateRepository.create({
        resolveClient: ClickHouseSimulationSession.resolver(unready),
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

  describe("given a batch and a scenario set written eight weeks ago (the second id indexes)", () => {
    const readyRepository = () => repositoryOver(clickhouse);
    const unreadyRepository = () => repositoryOver(unready);
    const batchRunId = `${scenarioRunId}-batch`;
    const scenarioSetId = `${scenarioRunId}-set`;

    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("reads the batch's summary by batch run id alone inside the batch index's range", async () => {
      const found = await readyRepository().findBatchSummary({ projectId: tenantId, batchRunId });

      expect(found?.batchRunId).toBe(batchRunId);
      expect(outcomes).toContainEqual({ table: "simulation_runs", outcome: "index_hit" });
      const bounded = sourceReadOf("simulation_runs");
      expect(bounded.params).toMatchObject({
        idBound_fromMs: eightWeeksAgoMs - DAY_MS,
        idBound_toMs: eightWeeksAgoMs + DAY_MS,
      });
      expect(bounded.sql.match(/idBound_fromMs/g)).toHaveLength(2);
      statements = [];
      await unreadyRepository().findBatchSummary({ projectId: tenantId, batchRunId });
      expect(sourceReadOf("simulation_runs").sql).not.toContain("idBound_fromMs");
      expect(await partsAfterPartitionPruning({ query: queryRows, request: bounded })).toBeLessThan(
        await partsAfterPartitionPruning({
          query: queryRows,
          request: sourceReadOf("simulation_runs"),
        }),
      );
    });

    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("counts the set's batches by scenario set id alone inside the set index's range", async () => {
      const found = await readyRepository().findBatchRunCountForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
      });

      expect(found).toBe(1);
      expect(outcomes).toContainEqual({ table: "simulation_runs", outcome: "index_hit" });
      const bounded = sourceReadOf("simulation_runs");
      expect(bounded.params).toMatchObject({
        idBound_fromMs: eightWeeksAgoMs - DAY_MS,
        idBound_toMs: eightWeeksAgoMs + DAY_MS,
      });
      expect(bounded.sql.match(/idBound_fromMs/g)).toHaveLength(2);
      statements = [];
      await unreadyRepository().findBatchRunCountForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
      });
      expect(sourceReadOf("simulation_runs").sql).not.toContain("idBound_fromMs");
      expect(await partsAfterPartitionPruning({ query: queryRows, request: bounded })).toBeLessThan(
        await partsAfterPartitionPruning({
          query: queryRows,
          request: sourceReadOf("simulation_runs"),
        }),
      );
    });
  });
});
