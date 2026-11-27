/** @vitest-environment node */

/**
 * The storage read billing uses for retention above 90 days, against the migrated ClickHouse:
 * every metered table is filtered on the column it is partitioned by, and only older rows count.
 * A native ClickHouse when LANGWATCH_TEST_CLICKHOUSE_URL is set, else a container.
 * @see specs/billing/retention-storage-billing.feature
 */
import { randomUUID } from "node:crypto";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver, TenantGuard } from "@langwatch/clickhouse-client";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { PRODUCTION_STORAGE_METER_TABLES } from "@langwatch/data-retention-contract/retention-tables";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ClickHouseStorageMeterRepository,
  STORAGE_METER_ROW_TIME,
} from "../clickhouse.storage-meter.repository.ts";

const DAY_MS = 86_400_000;
const tenantId = `${randomUUID()}-storage-meter`;
const now = Date.now();

let ch: ClickHouseClient;
let repository: ClickHouseStorageMeterRepository;

function queryClient(client: ClickHouseClient): ClickHouseQueryClient {
  const driver: QueryDriver = {
    async execute(request) {
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
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

function span({ id, atMs }: { id: string; atMs: number }): Record<string, unknown> {
  const at = new Date(atMs).toISOString();
  return {
    ProjectionId: `${id}-projection`,
    TenantId: tenantId,
    TraceId: `${id}-trace`,
    SpanId: id,
    SpanName: "llm",
    StartTime: at,
    EndTime: at,
    UpdatedAt: at,
    _retention_days: 371,
  };
}

beforeAll(async () => {
  const [endpoint] = await startTestClickHouseEndpoints({
    suite: "storage-meter",
    names: ["schema"],
    environment: process.env,
  });
  if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for the storage meter");
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
  repository = ClickHouseStorageMeterRepository.create({ clickhouse: queryClient(ch) });
  await ch.insert({
    table: "stored_spans",
    format: "JSONEachRow",
    values: [
      span({ id: "old-1", atMs: now - 120 * DAY_MS }),
      span({ id: "old-2", atMs: now - 120 * DAY_MS }),
      span({ id: "new-1", atMs: now }),
    ],
  });
}, 180_000);

afterAll(async () => {
  if (!ch) return;
  await ch.command({
    query: "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
    query_params: { tenantId },
  });
  await ch.close();
});

describe("ClickHouseStorageMeterRepository on the migrated schema", () => {
  /** @scenario "The storage read filters every metered table on its partition column" */
  it("names, for every metered table, the column its partition key is built from", async () => {
    const result = await ch.query({
      query:
        "SELECT name, partition_key FROM system.tables WHERE database = currentDatabase() AND name IN {tables:Array(String)}",
      query_params: { tables: [...PRODUCTION_STORAGE_METER_TABLES] },
      format: "JSONEachRow",
    });
    const rows: { name: string; partition_key: string }[] = await result.json();

    expect(rows.map((row) => row.name).toSorted()).toEqual(
      [...PRODUCTION_STORAGE_METER_TABLES].toSorted(),
    );
    for (const row of rows) {
      const column = STORAGE_METER_ROW_TIME[row.name as keyof typeof STORAGE_METER_ROW_TIME];
      expect(column, row.name).toBeDefined();
      expect(row.partition_key, row.name).toContain(column);
    }
  });

  /** @scenario "The storage read counts only rows written before the cutoff" */
  it("counts the bytes of rows older than the cutoff only", async () => {
    const cutoff = now - 91 * DAY_MS;

    const older = await repository.getTenantBytesBefore({ tenantId, beforeMs: cutoff });
    const all = await repository.getTenantBytes({ tenantId });
    const everything = await repository.getTenantBytesBefore({ tenantId, beforeMs: now + DAY_MS });

    expect(older).toBeGreaterThan(0);
    expect(older).toBeLessThan(all);
    expect(everything).toBe(all);
  });
});
