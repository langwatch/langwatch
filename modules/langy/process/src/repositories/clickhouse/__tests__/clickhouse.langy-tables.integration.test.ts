/** @vitest-environment node */

/**
 * ADR-202, "Tables are typed descriptors": every column langy's descriptor declares exists on
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

import { LangyAnalyticsEventClickHouseRepository } from "../clickhouse.langy-analytics-event.repository.ts";
import { langyAnalyticsEvents } from "../clickhouse.langy-analytics-events.table.ts";

const DESCRIPTORS: readonly { readonly $table: ClickHouseTableFacts }[] = [langyAnalyticsEvents];

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
    suite: "langy-tables",
    names: ["schema"],
    environment: process.env,
  });
  if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for langy's descriptors");
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

describe("langy's descriptors against the migrated schema", () => {
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

const METERED_TABLES = ["langy_analytics_events"] as const;

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

describe("langy's stored bytes against the migrated schema", () => {
  const tag = randomUUID();
  const ours = `${tag}-ours`;
  const theirs = `${tag}-theirs`;

  beforeAll(async () => {
    // `_size_bytes` is MATERIALIZED from the variable-width dimensions, so rows differ by those.
    const row = (tenantId: string, eventId: string, aggregateId: string) => ({
      TenantId: tenantId,
      EventId: eventId,
      EventType: "lw.langy_conversation.conversation_started",
      EventVersion: "2026-07-12",
      AggregateId: aggregateId,
      OccurredAt: Date.now(),
      AcceptedAt: Date.now(),
    });
    await ch!.insert({
      table: "langy_analytics_events",
      values: [
        row(ours, "event_a", "conversation_1"),
        row(ours, "event_b", "conversation_two"),
        row(theirs, "event_a", "conversation_3"),
      ],
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

  /** @scenario "Langy's stored bytes count only this project's rows" */
  it("sums this project's `_size_bytes` as main's raw read does, without the other tenant's", async () => {
    const bytes = await LangyAnalyticsEventClickHouseRepository.overMember(
      queryClientOver(ch!),
    ).getStoredBytes({ tenantId: ours });

    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBe(await rawStoredBytes(ours));
    expect(await rawStoredBytes(theirs)).toBeGreaterThan(0);
  });
});
