/** @vitest-environment node */

/**
 * ADR-202, "Tables are typed descriptors": every column suite's descriptors declare
 * exists on the migrated schema with the type it is declared as, so a descriptor cannot drift
 * from goose.
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import type { ClickHouseTableFacts } from "@langwatch/clickhouse-client/builder";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { suiteRuns } from "../clickhouse.suite-runs.table.ts";

const DESCRIPTORS: readonly { readonly $table: ClickHouseTableFacts }[] = [suiteRuns];

/**
 * The parameter type a stored column binds as: storage wrappers that change no value go, a time
 * (an array's members too) binds as epoch milliseconds, and a FixedString binds as String.
 */
const bindingOf = (type: string): string =>
  type
    .replace(/^SimpleAggregateFunction\(\w+, (.+)\)$/, "$1")
    .replaceAll(/LowCardinality\(([^()]*(?:\([^()]*\))?)\)/g, "$1")
    .replaceAll(/Nullable\(([^()]*(?:\([^()]*\))?)\)/g, "$1")
    .replaceAll(/DateTime64\(\d\)/g, "Int64")
    .replace(/^FixedString\(\d+\)$/, "String");

let ch: ClickHouseClient | undefined;

beforeAll(async () => {
  const [endpoint] = await startTestClickHouseEndpoints({
    suite: "suite-tables",
    names: ["schema"],
    environment: process.env,
  });
  if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for suite's descriptors");
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

describe("suite's descriptors against the migrated schema", () => {
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
