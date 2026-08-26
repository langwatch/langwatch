/**
 * @vitest-environment node
 * @integration
 *
 * Checks the storage meter against a real migrated ClickHouse schema rather
 * than a mocked client.
 *
 * Metering enrolls a table by listing it in the retention map, but summing
 * `_size_bytes` only works if that table's migration declared the column. The
 * two are independent, nothing connected them, and four tables were enrolled
 * without the column: every metering call then raised UNKNOWN_IDENTIFIER,
 * failed the single-query total, and fell back to the per-table path. A mocked
 * client cannot see that, because the mock answers whatever it is asked.
 *
 * So the guard here is deliberately schema-level: every metered table must
 * actually answer the query the service builds for it.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  PRODUCTION_STORAGE_METER_TABLES,
  RETENTION_MANAGED_TABLES,
} from "@langwatch/data-retention-server/retention-tables";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import { StorageMeterService } from "../storageMeter.service";

let ch: ClickHouseClient;
let meter: StorageMeterService;

const tenantId = `${nanoid()}-project`;

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  meter = new StorageMeterService({
    resolveClickHouseClient: async () => ch,
  });
}, 60_000);

afterAll(async () => {
  await stopTestContainers();
});

describe("given the production-metered table list", () => {
  // Guards the suite itself: every table-driven case below is an it.each over
  // this list, so an empty list would make them all vacuously pass.
  it("names at least one table to meter", () => {
    expect(PRODUCTION_STORAGE_METER_TABLES.length).toBeGreaterThan(0);
  });

  describe("when each table is asked for its metered size", () => {
    it.each(PRODUCTION_STORAGE_METER_TABLES)(
      "%s answers sum(_size_bytes)",
      async (table) => {
        const result = await ch.query({
          query: `SELECT sum(_size_bytes) AS total FROM ${table} WHERE TenantId = {tenantId:String}`,
          query_params: { tenantId },
          format: "JSONEachRow",
        });
        const rows = (await result.json()) as Array<{ total: string }>;

        expect(Number(rows[0]?.total ?? 0)).toBe(0);
      },
    );
  });

  describe("when they are summed the way the meter does it", () => {
    it("answers as one aggregate instead of failing to the per-table path", async () => {
      // The shape queryTotalBytes builds: pre-aggregate per table, then sum one
      // scalar per table. One table that cannot answer fails the whole query,
      // which is the regression this pins.
      const unions = PRODUCTION_STORAGE_METER_TABLES.map(
        (table) =>
          `SELECT sum(_size_bytes) AS t FROM ${table} WHERE TenantId = {tenantId:String}`,
      ).join("\n  UNION ALL\n  ");
      const result = await ch.query({
        query: `SELECT sum(t) AS total FROM (\n  ${unions}\n)`,
        query_params: { tenantId },
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as Array<{ total: string }>;

      expect(Number(rows[0]?.total ?? 0)).toBe(0);
    });
  });

  describe("when the service reports a breakdown", () => {
    it("returns every category without degrading a table to zero", async () => {
      const breakdown = await meter.getStorageBreakdown({ tenantId });

      expect(breakdown).toEqual({
        totalBytes: 0,
        byCategory: { traces: 0, scenarios: 0, experiments: 0 },
      });
    });
  });
});

describe("given the analytics projections that never declared _size_bytes", () => {
  // Named rather than derived from the metered list, which would only restate
  // how that list was built. These four are the ADR-034 projections created by
  // migrations 00038 to 00041.
  const tablesWithoutSizeColumn = [
    "trace_analytics",
    "trace_analytics_rollup",
    "evaluation_analytics",
    "evaluation_analytics_rollup",
  ] as const;

  it.each(tablesWithoutSizeColumn)(
    "keeps %s retention-managed while excluding it from metering",
    (table) => {
      expect(RETENTION_MANAGED_TABLES).toContain(table);
      expect(PRODUCTION_STORAGE_METER_TABLES).not.toContain(table);
    },
  );

  describe("when one is asked for its metered size anyway", () => {
    it.each(tablesWithoutSizeColumn)(
      "%s rejects the query rather than reporting zero",
      async (table) => {
        await expect(
          ch.query({
            query: `SELECT sum(_size_bytes) AS total FROM ${table} WHERE TenantId = {tenantId:String}`,
            query_params: { tenantId },
            format: "JSONEachRow",
          }),
        ).rejects.toThrow(/_size_bytes/);
      },
    );
  });
});
