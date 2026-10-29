/** @vitest-environment node */

/**
 * The id index retention raise on a fixture index shaped as the goose template writes it: one
 * mutation raises each tenant to its own days, never lowers a row, writes a source's 0 as kept
 * forever and leaves the marker row alone. Spec: specs/clickhouse/id-index-reads.feature
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestClickHouseEndpoints } from "../clickhouse-test-endpoints.ts";
import { ID_INDEX_FILL_MARKER } from "../idIndexReadiness.ts";
import { ID_INDEX_RETENTION_RAISE, idIndexRetentionRaises } from "../idIndexRetention.ts";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const INDEX = `fixture_retention_${RUN}_id_index`;

let probe: ClickHouseClient;

async function retentionByTenant(): Promise<Record<string, number>> {
  const result = await probe.query({
    query: `SELECT TenantId, toUInt32(max(_retention_days)) AS days FROM ${INDEX} GROUP BY TenantId`,
    format: "JSONEachRow",
  });
  const rows = await result.json<{ TenantId: string; days: number | string }>();
  return Object.fromEntries(rows.map((row) => [row.TenantId, Number(row.days)]));
}

async function mutationsOn(): Promise<number> {
  const result = await probe.query({
    query:
      "SELECT count() AS n FROM system.mutations " +
      "WHERE database = currentDatabase() AND table = {table:String}",
    query_params: { table: INDEX },
    format: "JSONEachRow",
  });
  const [row] = await result.json<{ n: number | string }>();
  return Number(row?.n);
}

describe("an id index retention raise", () => {
  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "id-index-retention",
      names: ["shared"],
      environment: process.env,
    });
    if (endpoint === undefined) throw new Error("No ClickHouse endpoint was provisioned");
    probe = createClient({
      url: endpoint.url,
      clickhouse_settings: { date_time_input_format: "best_effort", mutations_sync: "2" },
    });
    await probe.command({
      query: `CREATE TABLE IF NOT EXISTS ${INDEX} (
        TenantId String,
        TraceId String,
        FromAt SimpleAggregateFunction(min, DateTime64(3)),
        ToAt SimpleAggregateFunction(max, DateTime64(3)),
        _retention_days SimpleAggregateFunction(max, UInt16)
      ) ENGINE = AggregatingMergeTree() ORDER BY (TenantId, TraceId)
      TTL IF(_retention_days BETWEEN 1 AND 65534, toDateTime(ToAt) + toIntervalDay(_retention_days + 7), toDateTime('2106-01-01')) DELETE`,
    });
    const now = new Date().toISOString();
    const row = (tenantId: string, days: number) => ({
      TenantId: tenantId,
      TraceId: `trace-${tenantId}`,
      FromAt: now,
      ToAt: now,
      _retention_days: days,
    });
    await probe.insert({
      table: INDEX,
      format: "JSONEachRow",
      values: [
        row("lengthened", 30),
        row("shortened", 365),
        row("now-forever", 30),
        row("already-forever", 65_535),
        row("not-listed", 30),
        { ...row("", 65_535), TraceId: ID_INDEX_FILL_MARKER },
      ],
    });
  }, 300_000);

  afterAll(async () => {
    await probe?.command({ query: `DROP TABLE IF EXISTS ${INDEX}` });
    await probe?.close();
  }, 60_000);

  describe("given tenants whose retention was lengthened, shortened and made forever", () => {
    /** @scenario "a retention raise is one statement per index, never lowering a row" */
    it("raises each in one mutation, never lowers one, and leaves the marker and others alone", async () => {
      const before = await mutationsOn();
      const raises = idIndexRetentionRaises({
        daysByTenant: new Map([
          ["lengthened", 365],
          ["shortened", 30],
          ["now-forever", 0],
          ["already-forever", 30],
        ]),
      });

      for (const params of raises) {
        await probe.command({
          query: `ALTER TABLE ${INDEX} ${ID_INDEX_RETENTION_RAISE}`,
          query_params: params,
        });
      }

      expect(raises).toHaveLength(1);
      expect((await mutationsOn()) - before).toBe(1);
      expect(await retentionByTenant()).toEqual({
        lengthened: 365,
        shortened: 365,
        "now-forever": 65_535,
        "already-forever": 65_535,
        "not-listed": 30,
        "": 65_535,
      });
    });
  });

  describe("given more tenants than one URL field carries", () => {
    /** Ids as long as production's, so 6000 of them pass the 128 KiB field cap in one raise. */
    const tenants = Array.from(
      { length: 6000 },
      (_, at) => `crowded_${String(at).padStart(24, "0")}`,
    );

    beforeAll(async () => {
      const now = new Date().toISOString();
      await probe.insert({
        table: INDEX,
        format: "JSONEachRow",
        values: tenants.map((tenantId) => ({
          TenantId: tenantId,
          TraceId: `trace-${tenantId}`,
          FromAt: now,
          ToAt: now,
          _retention_days: 30,
        })),
      });
    }, 120_000);

    it("is refused in one raise at the old 512 KiB budget", async () => {
      const daysByTenant = new Map(tenants.map((tenantId) => [tenantId, 90]));
      const [single, ...rest] = idIndexRetentionRaises({ daysByTenant, paramBytes: 512 * 1024 });

      expect(rest).toHaveLength(0);
      await expect(
        probe.command({
          query: `ALTER TABLE ${INDEX} ${ID_INDEX_RETENTION_RAISE}`,
          query_params: single,
        }),
      ).rejects.toThrow(/Field value too long/);
    });

    it("splits under the field cap and raises every tenant", async () => {
      const daysByTenant = new Map(tenants.map((tenantId) => [tenantId, 180]));
      const raises = idIndexRetentionRaises({ daysByTenant });

      for (const params of raises) {
        await probe.command({
          query: `ALTER TABLE ${INDEX} ${ID_INDEX_RETENTION_RAISE}`,
          query_params: params,
        });
      }

      expect(raises.length).toBeGreaterThan(1);
      const raised = await retentionByTenant();
      expect(tenants.filter((tenantId) => raised[tenantId] !== 180)).toEqual([]);
    });
  });
});
