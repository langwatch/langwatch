/** @vitest-environment node */

/**
 * ADR-202, "Tables are typed descriptors": every column scenario's descriptors declare
 * exists on the migrated schema with the type it is declared as, so a descriptor cannot drift
 * from goose.
 */
import { randomUUID } from "node:crypto";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import type { ClickHouseTableFacts } from "@langwatch/clickhouse-client/builder";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { simulationRunMetricsRollup } from "../clickhouse.simulation-run-metrics-rollup.table.ts";
import { simulationRunMetrics } from "../clickhouse.simulation-run-metrics.table.ts";
import { simulationRuns } from "../clickhouse.simulation-runs.table.ts";
import {
  simulationRepositoryOver,
  simulationRunRow,
} from "./simulation-clickhouse-rows.fixture.ts";

const DESCRIPTORS: readonly { readonly $table: ClickHouseTableFacts }[] = [
  simulationRuns,
  simulationRunMetrics,
  simulationRunMetricsRollup,
];

/**
 * The parameter type a stored column binds as: storage wrappers that change no value go, a time
 * (an array's members too) binds as epoch milliseconds, and a FixedString binds as String. An
 * aggregate state binds nothing, so it is compared as stored.
 */
const bindingOf = (type: string): string =>
  type.startsWith("AggregateFunction(")
    ? type
    : type
        .replace(/^SimpleAggregateFunction\(\w+, (.+)\)$/, "$1")
        .replaceAll(/LowCardinality\(([^()]*(?:\([^()]*\))?)\)/g, "$1")
        .replaceAll(/Nullable\(([^()]*(?:\([^()]*\))?)\)/g, "$1")
        .replaceAll(/DateTime64\(\d\)/g, "Int64")
        .replace(/^FixedString\(\d+\)$/, "String");

let ch: ClickHouseClient | undefined;

beforeAll(async () => {
  const [endpoint] = await startTestClickHouseEndpoints({
    suite: "scenario-tables",
    names: ["schema"],
    environment: process.env,
  });
  if (!endpoint)
    throw new Error("No ClickHouse endpoint was provisioned for scenario's descriptors");
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
  ch = createClient({ url: endpoint.url });
}, 120_000);

afterAll(async () => {
  await ch?.close();
});

describe("scenario's descriptors against the migrated schema", () => {
  it.each(DESCRIPTORS.map((table) => [table.$table.stored, table] as const))(
    "declares only %s columns the schema has, binding as their stored types",
    async (name, table) => {
      const result = await ch!.query({
        query:
          "SELECT name, type FROM system.columns WHERE database = currentDatabase() AND table = {table:String}",
        query_params: { table: name },
        format: "JSONEachRow",
      });
      const stored = new Map(
        ((await result.json()) as { name: string; type: string }[]).map((each) => [
          each.name,
          bindingOf(each.type),
        ]),
      );
      const declared = Object.fromEntries(
        table.$table.columns.map((each) => {
          const ref = Reflect.get(table, each) as { binding: { paramType: string } };
          return [each, ref.binding.paramType];
        }),
      );

      expect(declared).toEqual(
        Object.fromEntries(table.$table.columns.map((each) => [each, stored.get(each)])),
      );
    },
  );
});

/** Main's meter read: the raw `_size_bytes` sum over one tenant's rows in `simulation_runs`. */
async function rawStoredBytes(tenantId: string): Promise<number> {
  const result = await ch!.query({
    query:
      "SELECT sum(_size_bytes) AS total FROM simulation_runs WHERE TenantId = {tenantId:String}",
    query_params: { tenantId },
    format: "JSONEachRow",
  });
  const [row] = (await result.json()) as { total: string }[];
  return Number(row?.total ?? 0);
}

describe("scenario's stored bytes against the migrated schema", () => {
  const tag = randomUUID();
  const ours = `${tag}-ours`;
  const theirs = `${tag}-theirs`;

  beforeAll(async () => {
    const run = (tenantId: string, batchRunId: string) =>
      simulationRunRow({ tenantId, scenarioSetId: "set_1", batchRunId, metadata: null });
    await ch!.insert({
      table: "simulation_runs",
      values: [run(ours, "batch_1"), run(ours, "batch_2"), run(theirs, "batch_1")],
      format: "JSONEachRow",
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
  });

  afterAll(async () => {
    await ch?.command({
      query: "ALTER TABLE simulation_runs DELETE WHERE TenantId IN ({tenants:Array(String)})",
      query_params: { tenants: [ours, theirs] },
    });
  });

  /** @scenario "Scenario's stored bytes count only this project's rows" */
  it("sums this project's `_size_bytes` as main's raw read does, without the other tenant's", async () => {
    const bytes = await simulationRepositoryOver(ch!).getStoredBytes({ projectId: ours });

    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBe(await rawStoredBytes(ours));
    expect(await rawStoredBytes(theirs)).toBeGreaterThan(0);
  });
});
