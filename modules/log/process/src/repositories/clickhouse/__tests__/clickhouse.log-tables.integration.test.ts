/** @vitest-environment node */

/**
 * ADR-202, "Tables are typed descriptors": every column log's descriptor declares exists on
 * the migrated schema with the type it is declared as; and the storage meter's read (Decided 20).
 */
import { randomUUID } from "node:crypto";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver, TenantGuard } from "@langwatch/clickhouse-client";
import type { ClickHouseTableFacts } from "@langwatch/clickhouse-client/builder";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseCanonicalLogRecordAppendRepository } from "../clickhouse.canonical-log-record-append.repository.ts";
import { logRecords } from "../clickhouse.log-records.table.ts";

const DESCRIPTORS: readonly { readonly $table: ClickHouseTableFacts }[] = [logRecords];

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
    suite: "log-tables",
    names: ["schema"],
    environment: process.env,
  });
  if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for log's descriptors");
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

describe("log's descriptors against the migrated schema", () => {
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

const METERED_TABLES = ["log_records"] as const;

/** The routed member over the migrated test server, as the process hands it to the module. */
function queryClientOver(client: ClickHouseClient): ClickHouseQueryClient {
  const driver: QueryDriver = {
    async execute(request) {
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
      return { rows: await result.json() };
    },
    async insert(request) {
      await client.insert({ table: request.table, values: request.rows, format: "JSONEachRow" });
    },
    async command(request) {
      await client.command({ query: request.sql });
    },
  };
  return new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
}

/** Main's meter read: the raw `_size_bytes` sum over one tenant's rows in each metered table. */
async function rawStoredBytes(tenantId: string): Promise<number> {
  let total = 0;
  for (const table of METERED_TABLES) {
    const result = await ch!.query({
      query: `SELECT sum(_size_bytes) AS total FROM ${table} WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
      format: "JSONEachRow",
    });
    const [row] = (await result.json()) as { total: string }[];
    total += Number(row?.total ?? 0);
  }
  return total;
}

describe("log's stored bytes against the migrated schema", () => {
  const tag = randomUUID();
  const ours = `${tag}-ours`;
  const theirs = `${tag}-theirs`;

  beforeAll(async () => {
    const row = (tenantId: string, recordId: string, sizeBytes: number) => ({
      TenantId: tenantId,
      RecordId: recordId.repeat(64),
      CorrelationTraceId: "trace_1",
      TimeUnixMs: Date.now(),
      _size_bytes: sizeBytes,
    });
    await ch!.insert({
      table: "log_records",
      values: [row(ours, "a", 120), row(ours, "b", 80), row(theirs, "a", 50)],
      format: "JSONEachRow",
    });
  });

  afterAll(async () => {
    for (const table of METERED_TABLES) {
      await ch?.command({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId IN ({tenants:Array(String)})`,
        query_params: { tenants: [ours, theirs] },
      });
    }
  });

  /** @scenario "Log's stored bytes count only this project's rows" */
  it("sums this project's `_size_bytes` as main's raw read does, without the other tenant's", async () => {
    const clickhouse = queryClientOver(ch!);
    const bytes = await ClickHouseCanonicalLogRecordAppendRepository.create({
      resolveClient: ClickHouseCanonicalLogRecordAppendRepository.resolverOver(clickhouse),
      clickhouse,
      defaultRetentionDays: 30,
    }).getStoredBytes({ tenantId: ours });

    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBe(await rawStoredBytes(ours));
    expect(await rawStoredBytes(theirs)).toBeGreaterThan(0);
  });
});
