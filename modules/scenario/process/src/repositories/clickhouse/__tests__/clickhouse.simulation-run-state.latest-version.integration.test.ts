/**
 * The run-state read's latest-version election on a run of many unmerged versions, the scalar
 * subquery it sends today against the built candidate (a CTE of max(UpdatedAt)), on 26.8.
 * Numbers: .claude/handoffs/rp-port-scenario-suite.md section 11, Risk 1.
 */
import { type ClickHouseSettings, createClient, type ClickHouseClient } from "@clickhouse/client";
import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { createTenantId } from "@langwatch/eventing";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SimulationRunState } from "../../../eventing/simulation-run-state.projection.ts";
import { ClickHouseSimulationRunStateRepository } from "../clickhouse.simulation-run-state.repository.ts";
import { simulationRuns } from "../clickhouse.simulation-runs.table.ts";
import { scenarioClickHouseOver } from "./simulation-clickhouse-rows.fixture.ts";

const tenantId = `test-sim-latest-version-${nanoid()}`;
const context = { tenantId: createTenantId(tenantId) };
const SNAPSHOTS = 2_000;
const PER_INSERT = 100;
const now = Date.now();
const window = { fromMs: now - 60 * 60_000, toMs: now + 60 * 60_000 };

let ch: ClickHouseClient | undefined;
let repo: ClickHouseSimulationRunStateRepository<SimulationRunState>;

beforeAll(async () => {
  const [endpoint] = await startTestClickHouseEndpoints({
    suite: "simulation-run-state-latest-version",
    names: ["schema"],
    environment: process.env,
  });
  if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for the run-state suite");
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
  const client = createClient({
    url: endpoint.url,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
  ch = client;
  repo = ClickHouseSimulationRunStateRepository.create<SimulationRunState>({
    resolveClient: scenarioClickHouseOver(client),
    defaultRetentionDays: () => 30,
  });
}, 180_000);

afterAll(async () => {
  if (!ch) return;
  await ch.command({ query: "SYSTEM START MERGES simulation_runs" });
  await ch.close();
});

/** One stored version of the run, with twenty messages of content as a real snapshot carries. */
function snapshot({ scenarioRunId, index }: { scenarioRunId: string; index: number }) {
  const messages = Array.from({ length: 20 }, (_, m) => m);
  return {
    ProjectionId: scenarioRunId,
    TenantId: tenantId,
    ScenarioRunId: scenarioRunId,
    ScenarioId: "scenario-latest",
    BatchRunId: "batch-latest",
    ScenarioSetId: "set-latest",
    Version: "v1",
    Status: "IN_PROGRESS",
    Name: `version ${index}`,
    "Messages.Id": messages.map((m) => `msg-${m}`),
    "Messages.Role": messages.map((m) => (m % 2 === 0 ? "user" : "assistant")),
    "Messages.Content": messages.map((m) => `snapshot ${index} message ${m} `.repeat(10)),
    "Messages.TraceId": messages.map((m) => `trace-${m}`),
    "Messages.Rest": messages.map(() => "{}"),
    TraceIds: [],
    MetCriteria: [],
    UnmetCriteria: [],
    TraceMetricsJson: "",
    StartedAt: new Date(now),
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now + index),
    LastSnapshotOccurredAt: new Date(0),
    LastEventOccurredAt: new Date(now),
    _retention_days: 30,
  };
}

/** The candidate: the version elected by `UpdatedAt IN latest`, a CTE of `max(UpdatedAt)`. */
function candidateRead({ scenarioRunId }: { scenarioRunId: string }) {
  const t = simulationRuns;
  return clickhouseRead({ scope: tenantScope.single({ tenantId }) })
    .from(t)
    .with("latest", (sub) =>
      sub
        .from(t)
        .select({ latestUpdatedAt: fn.max(t.UpdatedAt) })
        .where(({ and, eq, gte, lte }) =>
          and(
            eq(t.ScenarioRunId, scenarioRunId),
            gte(t.StartedAt, window.fromMs),
            lte(t.StartedAt, window.toMs),
          ),
        ),
    )
    .select({
      projectionId: t.ProjectionId,
      name: t.Name,
      messageIds: t["Messages.Id"],
      messageRoles: t["Messages.Role"],
      messageContents: t["Messages.Content"],
      messageTraceIds: t["Messages.TraceId"],
      messageRests: t["Messages.Rest"],
      updatedAtMs: fn.toUnixTimestamp64Milli(t.UpdatedAt),
    })
    .where(({ and, eq, gte, lte, oneOf }) =>
      and(
        eq(t.ScenarioRunId, scenarioRunId),
        gte(t.StartedAt, window.fromMs),
        lte(t.StartedAt, window.toMs),
        oneOf(t.UpdatedAt, { cte: "latest" }),
      ),
    )
    .limit(1)
    .build();
}

type Measured = { readRows: number; readBytes: number; memoryUsage: number; granules: number };

async function measure({
  sql,
  params,
  settings,
}: {
  sql: string;
  params: Record<string, unknown>;
  settings: ClickHouseSettings;
}): Promise<Measured> {
  const queryId = `latest-version-${nanoid()}`;
  const result = await ch!.query({
    query: sql,
    query_params: params,
    query_id: queryId,
    clickhouse_settings: settings,
    format: "JSONEachRow",
  });
  await result.json();
  const explained = await ch!.query({
    query: `EXPLAIN indexes = 1 ${sql}`,
    query_params: params,
    clickhouse_settings: settings,
    format: "TabSeparatedRaw",
  });
  const plan = await explained.text();
  const granules = [...plan.matchAll(/Granules: (\d+)\/\d+/g)].reduce(
    (sum, match) => sum + Number(match[1]),
    0,
  );
  await ch!.command({ query: "SYSTEM FLUSH LOGS" });
  const logged = await ch!.query({
    query: `SELECT read_rows AS readRows, read_bytes AS readBytes, memory_usage AS memoryUsage
            FROM system.query_log WHERE query_id = {queryId:String} AND type = 'QueryFinish' LIMIT 1`,
    query_params: { queryId },
    format: "JSONEachRow",
  });
  const [row] = await logged.json<Record<string, string | number>>();
  return {
    readRows: Number(row?.readRows),
    readBytes: Number(row?.readBytes),
    memoryUsage: Number(row?.memoryUsage),
    granules,
  };
}

describe("the scenario-run state latest-version read", () => {
  describe("when a run holds many unmerged snapshots", () => {
    it("elects the latest version, the scalar form reading no more rows than the candidate", async () => {
      const scenarioRunId = `run-many-${nanoid()}`;
      await ch!.command({ query: "SYSTEM STOP MERGES simulation_runs" });
      for (let from = 0; from < SNAPSHOTS; from += PER_INSERT) {
        await ch!.insert({
          table: "simulation_runs",
          values: Array.from({ length: PER_INSERT }, (_, i) =>
            snapshot({ scenarioRunId, index: from + i }),
          ),
          format: "JSONEachRow",
          // Every version stays its own row: no insert-time replacing, no background merge.
          clickhouse_settings: { optimize_on_insert: 0, async_insert: 0 },
        });
      }
      const stored = await ch!.query({
        query: `SELECT count() AS n FROM simulation_runs WHERE TenantId = {tenantId:String} AND ScenarioRunId = {scenarioRunId:String}`,
        query_params: { tenantId, scenarioRunId },
        format: "JSONEachRow",
      });
      const [{ n } = { n: 0 }] = await stored.json<{ n: string | number }>();

      const windowed = await repo.findProjection(scenarioRunId, { ...context, readWindow: window });
      const unbounded = await repo.findProjection(scenarioRunId, context);

      const statement = candidateRead({ scenarioRunId });
      const cteBody = /^WITH latest AS \((.*?)\) SELECT /.exec(statement.sql)?.[1];
      expect(cteBody).toBeDefined();
      const scalarSql = statement.sql
        .replace(/^WITH latest AS \(.*?\) SELECT /, "SELECT ")
        .replace("UpdatedAt IN latest", `UpdatedAt = (${cteBody})`);
      const shared = {
        params: { ...statement.params },
        settings: { ...statement.settings } as ClickHouseSettings,
      };
      const median = async (sql: string): Promise<Measured> => {
        const runs = [];
        for (let i = 0; i < 3; i++) runs.push(await measure({ sql, ...shared }));
        const memory =
          runs.map((run) => run.memoryUsage).toSorted((x, y) => x - y)[1] ?? Number.NaN;
        return { ...runs[0]!, memoryUsage: memory };
      };
      const scalar = await median(scalarSql);
      const cte = await median(statement.sql);
      const candidate = (
        await ch!.query({
          query: statement.sql,
          query_params: shared.params,
          clickhouse_settings: shared.settings,
          format: "JSONEachRow",
        })
      ).json<{ name: string }>();

      expect(Number(n)).toBe(SNAPSHOTS);
      expect(windowed?.data.Name).toBe(`version ${SNAPSHOTS - 1}`);
      expect(unbounded?.data.Name).toBe(`version ${SNAPSHOTS - 1}`);
      expect(windowed?.data.Messages).toHaveLength(20);
      expect((await candidate)[0]?.name).toBe(`version ${SNAPSHOTS - 1}`);
      expect(scalar.readRows).toBeLessThanOrEqual(cte.readRows);
      expect(scalar.granules).toBeLessThanOrEqual(cte.granules);
    }, 240_000);
  });
});
