/** @vitest-environment node */

/**
 * Experiment lookups by id alone against the migrated ClickHouse (goose 00114): found through
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
  partsAfterPartitionPruning,
  readyIdIndexedClientDouble,
  type ScriptedStatements,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { createTenantId } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ClickhouseExperimentClickHouseRepository } from "../clickhouse.experiment-clickhouse.repository.ts";
import { ClickHouseExperimentDspyRepository } from "../clickhouse.experiment-dspy.repository.ts";
import {
  EXPERIMENT_ID_INDEXES,
  EXPERIMENT_SECOND_ID_INDEXES,
} from "../clickhouse.experiment-id-indexes.database.ts";
import { ClickHouseExperimentIdLookupRepository } from "../clickhouse.experiment-id-lookup.repository.ts";
import { ClickHouseExperimentRunStateRepository } from "../clickhouse.experiment-run-state.repository.ts";
import { ClickHouseExperimentRunRepository } from "../clickhouse.experiment-run.repository.ts";
import { ClickHouseExperimentSession } from "../clickhouse.experiment-session.store.ts";

const DAY_MS = 86_400_000;

const tenantId = `${randomUUID()}-experiment-id-index`;
const experimentId = `${tenantId}-experiment`;
const runId = `${tenantId}-run`;
const secondExperimentId = `${tenantId}-experiment-second`;
const secondRunId = `${tenantId}-run-second`;
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
let ready: ClickHouseQueryClient;
let unready: ClickHouseQueryClient;
const resolveClient = (tenant: string) => ClickHouseExperimentSession.resolverOver(ready)(tenant);
const resolveUnready = (tenant: string) =>
  ClickHouseExperimentSession.resolverOver(unready)(tenant);

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

/** The target alone, then each decoy partition's two ids written together in one insert. */
function writeGroups(): { id: string; atMs: number }[][] {
  return [
    [{ id: runId, atMs: eightWeeksAgoMs }],
    ...decoyAgesInDays.map((days) =>
      decoyIds.map((decoy) => ({ id: `${decoy}-${days}`, atMs: now - days * DAY_MS })),
    ),
  ];
}

beforeAll(async () => {
  const [endpoint] = await startTestClickHouseEndpoints({
    suite: "experiment-id-index",
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
  ready = await readyIdIndexedClientDouble({
    indexes: [...EXPERIMENT_ID_INDEXES, ...EXPERIMENT_SECOND_ID_INDEXES],
    driver: recordingDriver(ch),
  });
  unready = idIndexedClientDouble({
    indexes: [...EXPERIMENT_ID_INDEXES, ...EXPERIMENT_SECOND_ID_INDEXES],
    driver: recordingDriver(ch),
  });
  setWindowedReadMetrics({ record: (entry) => outcomes.push(entry) });

  for (const group of writeGroups()) {
    await ch.insert({
      table: "experiment_runs",
      format: "JSONEachRow",
      values: group.map(({ id, atMs }) => ({
        ProjectionId: `${id}-projection`,
        TenantId: tenantId,
        RunId: id,
        ExperimentId: experimentId,
        Version: "1",
        Targets: "[]",
        CreatedAt: iso(atMs),
        UpdatedAt: iso(atMs),
        StartedAt: iso(atMs),
        _retention_days: 308,
      })),
    });
    await ch.insert({
      table: "dspy_steps",
      format: "JSONEachRow",
      values: group.map(({ id, atMs }) => ({
        Id: `${tenantId}/${id}/0`,
        TenantId: tenantId,
        ExperimentId: experimentId,
        RunId: id,
        StepIndex: "0",
        OptimizerParameters: "{}",
        Predictors: "[]",
        Examples: "[]",
        LlmCalls: "[]",
        CreatedAt: iso(atMs),
        InsertedAt: iso(atMs),
        UpdatedAt: iso(atMs),
        _retention_days: 308,
      })),
    });
  }
  await writeSecondExperimentRun();
}, 120_000);

/** A run of an experiment no decoy shares, so the experiment index's range is one point. */
async function writeSecondExperimentRun(): Promise<void> {
  await ch.insert({
    table: "experiment_runs",
    format: "JSONEachRow",
    values: [
      {
        ProjectionId: `${secondRunId}-projection`,
        TenantId: tenantId,
        RunId: secondRunId,
        ExperimentId: secondExperimentId,
        Version: "1",
        Targets: "[]",
        CreatedAt: iso(eightWeeksAgoMs),
        UpdatedAt: iso(eightWeeksAgoMs),
        StartedAt: iso(eightWeeksAgoMs),
        _retention_days: 308,
      },
    ],
  });
}

beforeEach(() => {
  statements = [];
  outcomes = [];
});

afterAll(async () => {
  if (!ch) return;
  const tables = [
    "experiment_runs",
    "experiment_runs_id_index",
    "experiment_runs_by_experiment_id_index",
    "dspy_steps",
    "dspy_steps_id_index",
  ];
  for (const name of tables) {
    await ch.exec({
      query: `ALTER TABLE ${name} DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
  await ch.close();
});

describe("experiment lookups by id with the id index", () => {
  describe("given a run written eight weeks ago", () => {
    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("finds its experiment by run id alone inside the index's range", async () => {
      const lookup = ClickHouseExperimentIdLookupRepository.create({
        clickhouse: ClickhouseExperimentClickHouseRepository.create(resolveClient),
      });

      const found = await lookup.findExperimentId({ tenantId, runId });

      expect(found).toBe(experimentId);
      expect(outcomes).toContainEqual({ table: "experiment_runs", outcome: "index_hit" });
      const bounded = sourceReadOf("experiment_runs");
      expect(bounded.params).toMatchObject({
        idBound_fromMs: eightWeeksAgoMs - DAY_MS,
        idBound_toMs: eightWeeksAgoMs + DAY_MS,
      });
      statements = [];
      await ClickHouseExperimentIdLookupRepository.create({
        clickhouse: ClickhouseExperimentClickHouseRepository.create(resolveUnready),
      }).findExperimentId({ tenantId, runId });
      expect(await partsAfterPartitionPruning({ query: queryRows, request: bounded })).toBeLessThan(
        await partsAfterPartitionPruning({
          query: queryRows,
          request: sourceReadOf("experiment_runs"),
        }),
      );
    });

    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("reads the run's fold state inside the index's range", async () => {
      const repository = ClickHouseExperimentRunStateRepository.create({
        clickhouse: ClickhouseExperimentClickHouseRepository.create(resolveClient),
        defaultRetentionDays: () => 308,
      });

      const projection = await repository.findProjection(`${experimentId}:${runId}`, {
        tenantId: createTenantId(tenantId),
      });

      expect(projection?.data).toMatchObject({ RunId: runId, ExperimentId: experimentId });
      expect(outcomes).toContainEqual({ table: "experiment_runs", outcome: "index_hit" });
      const bounded = sourceReadOf("experiment_runs");
      expect(bounded.params).toMatchObject({
        idBound_fromMs: eightWeeksAgoMs - DAY_MS,
        idBound_toMs: eightWeeksAgoMs + DAY_MS,
      });
      statements = [];
      await ClickHouseExperimentRunStateRepository.create({
        clickhouse: ClickhouseExperimentClickHouseRepository.create(resolveUnready),
        defaultRetentionDays: () => 308,
      }).findProjection(`${experimentId}:${runId}`, { tenantId: createTenantId(tenantId) });
      expect(await partsAfterPartitionPruning({ query: queryRows, request: bounded })).toBeLessThan(
        await partsAfterPartitionPruning({
          query: queryRows,
          request: sourceReadOf("experiment_runs"),
        }),
      );
    });

    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("reads the run's history row by id alone inside the index's range", async () => {
      const runRepository = (resolve = resolveClient) =>
        ClickHouseExperimentRunRepository.create({
          workflowVersions: { findByIds: async () => ({}) },
          resolveClient: resolve,
          tupleParam: (values) => values,
          telemetry: {
            trace: (_input, operation) => operation(),
            warnOldRuns: () => undefined,
            error: () => undefined,
            warn: () => undefined,
          },
        });

      const found = await runRepository().findRun({ projectId: tenantId, experimentId, runId });

      expect(found?.runId).toBe(runId);
      expect(outcomes).toContainEqual({ table: "experiment_runs", outcome: "index_hit" });
      const bounded = sourceReadOf("experiment_runs");
      expect(bounded.params).toMatchObject({
        idBound_fromMs: eightWeeksAgoMs - DAY_MS,
        idBound_toMs: eightWeeksAgoMs + DAY_MS,
      });
      statements = [];
      await runRepository(resolveUnready).findRun({ projectId: tenantId, experimentId, runId });
      expect(await partsAfterPartitionPruning({ query: queryRows, request: bounded })).toBeLessThan(
        await partsAfterPartitionPruning({
          query: queryRows,
          request: sourceReadOf("experiment_runs"),
        }),
      );
    });

    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("reads its DSPy step and the experiment's steps inside the index's range", async () => {
      const dspyRepository = (resolve = resolveClient) =>
        ClickHouseExperimentDspyRepository.create({
          resolveClient: resolve,
          telemetry: { warn: () => undefined },
        });
      const repository = dspyRepository();

      const step = await repository.findStep({ tenantId, experimentId, runId, stepIndex: "0" });

      expect(step?.runId).toBe(runId);
      expect(outcomes).toContainEqual({ table: "dspy_steps", outcome: "index_hit" });
      const bounded = sourceReadOf("dspy_steps");
      expect(bounded.params).toMatchObject({
        idBound_fromMs: eightWeeksAgoMs - DAY_MS,
        idBound_toMs: eightWeeksAgoMs + DAY_MS,
      });
      statements = [];
      await dspyRepository(resolveUnready).findStep({
        tenantId,
        experimentId,
        runId,
        stepIndex: "0",
      });
      expect(await partsAfterPartitionPruning({ query: queryRows, request: bounded })).toBeLessThan(
        await partsAfterPartitionPruning({ query: queryRows, request: sourceReadOf("dspy_steps") }),
      );

      outcomes = [];
      const summaries = await repository.findAll({ tenantId, experimentId });
      expect(summaries.map((each) => each.runId)).toContain(runId);
      expect(outcomes).toContainEqual({ table: "dspy_steps", outcome: "index_hit" });
    });
  });

  describe("given an experiment whose run was written eight weeks ago", () => {
    const runRepository = (resolve = resolveClient) =>
      ClickHouseExperimentRunRepository.create({
        workflowVersions: { findByIds: async () => ({}) },
        resolveClient: resolve,
        tupleParam: (values) => values,
        telemetry: {
          trace: (_input, operation) => operation(),
          warnOldRuns: () => undefined,
          error: () => undefined,
          warn: () => undefined,
        },
      });

    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("counts its runs by experiment id alone inside the second index's range", async () => {
      const found = await runRepository().findAggregates({
        projectId: tenantId,
        experimentIds: [secondExperimentId],
      });

      expect(found[secondExperimentId]?.runsCount).toBe(1);
      expect(outcomes).toContainEqual({ table: "experiment_runs", outcome: "index_hit" });
      const bounded = sourceReadOf("experiment_runs");
      expect(bounded.params).toMatchObject({
        idBound_fromMs: eightWeeksAgoMs - DAY_MS,
        idBound_toMs: eightWeeksAgoMs + DAY_MS,
      });
      expect(bounded.sql.match(/idBound_fromMs/g)).toHaveLength(1);
      statements = [];
      const unreadied = await runRepository(resolveUnready).findAggregates({
        projectId: tenantId,
        experimentIds: [secondExperimentId],
      });
      expect(unreadied[secondExperimentId]?.runsCount).toBe(1);
      expect(sourceReadOf("experiment_runs").sql).not.toContain("idBound_fromMs");
      expect(await partsAfterPartitionPruning({ query: queryRows, request: bounded })).toBeLessThan(
        await partsAfterPartitionPruning({
          query: queryRows,
          request: sourceReadOf("experiment_runs"),
        }),
      );
    });
  });
});
