/**
 * The latest-version dedup every trace_summaries read shares, measured against a set of every
 * latest version on the same server: on many traces with few versions, and on many versions each.
 * @see specs/traces-v2/latest-version-dedup.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { latestTraceVersionOnly } from "@langwatch/trace-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();
const BASE = "toDateTime64('2026-10-01 00:00:00', 3)";
const SEED_SLICE = 200_000;
const READ_SETTINGS = { max_threads: 2, max_memory_usage: "900000000" } as const;

let ch: ClickHouseClient;

const seededTenants: string[] = [];

function freshTenant(): string {
  const tenant = `project_${nanoid(21).replace(/[^A-Za-z0-9]/g, "x")}`;
  seededTenants.push(tenant);
  return tenant;
}

function windowOf(tenant: string): string {
  return `TenantId = '${tenant}' AND OccurredAt >= ${BASE} - INTERVAL 1 DAY
    AND OccurredAt <= ${BASE} + INTERVAL 7 DAY`;
}

/** The dedup this replaced: a set of every trace's latest version in the window. */
function everyLatestVersion(where: string): string {
  return `(TenantId, TraceId, UpdatedAt) IN (
    SELECT TenantId, TraceId, max(UpdatedAt) FROM trace_summaries WHERE ${where}
    GROUP BY TenantId, TraceId)`;
}

/** One version per trace from `first`, `version` seconds after the trace's first version. */
async function seedVersions({
  tenant,
  first,
  count,
  version,
}: {
  tenant: string;
  first: number;
  count: number;
  version: number;
}) {
  await ch.command({
    query: `INSERT INTO trace_summaries (TenantId, TraceId, OccurredAt, UpdatedAt, TraceName, Attributes)
      SELECT {tenant:String}, lower(hex(sipHash128(number))),
        ${BASE} + toIntervalMillisecond(number * 100),
        ${BASE} + toIntervalMillisecond(number * 100 + ${version * 1000}),
        concat('name-', toString(number % 7)),
        map('service.name', 'svc', 'langwatch.version', toString(${version}))
      FROM numbers(${first}, ${count})`,
    query_params: { tenant },
    clickhouse_settings: { max_threads: 1, max_insert_threads: "1", max_block_size: "8192" },
  });
}

/** Counts the window's rows and those on `version`, and the read's peak memory in bytes. */
async function countLatest({
  tenant,
  dedup,
  version,
}: {
  tenant: string;
  dedup: string;
  version: number;
}): Promise<{ rows: number; onVersion: number; peakBytes: number }> {
  const queryId = nanoid();
  const result = await ch.query({
    query: `SELECT count() AS rows,
        countIf(Attributes['langwatch.version'] = '${version}') AS onVersion
      FROM trace_summaries WHERE ${windowOf(tenant)} AND ${dedup}`,
    query_id: queryId,
    format: "JSONEachRow",
    clickhouse_settings: READ_SETTINGS,
  });
  const [row] = await result.json<{ rows: string; onVersion: string }>();
  await ch.command({ query: "SYSTEM FLUSH LOGS" });
  const log = await ch.query({
    query: `SELECT memory_usage FROM system.query_log
      WHERE query_id = {queryId:String} AND type = 'QueryFinish'`,
    query_params: { queryId },
    format: "JSONEachRow",
  });
  const [entry] = await log.json<{ memory_usage: string }>();
  return {
    rows: Number(row?.rows),
    onVersion: Number(row?.onVersion),
    peakBytes: Number(entry?.memory_usage),
  };
}

describe.skipIf(!clickHouseConfigured)("given trace_summaries with superseded versions", () => {
  beforeAll(async () => {
    ch = await startMigratedTraceClickHouse();
    // Unmerged parts keep every seeded version until the reads finish.
    await ch.command({ query: "SYSTEM STOP MERGES trace_summaries" });
  });

  afterAll(async () => {
    if (!ch) return;
    await ch.command({ query: "SYSTEM START MERGES trace_summaries" });
    for (const tenantId of seededTenants) {
      await ch.command({
        query: "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId },
      });
    }
  });

  describe("when a trace has one version inside the window and a newer one after it", () => {
    const tenant = freshTenant();

    beforeAll(async () => {
      await seedVersions({ tenant, first: 0, count: 10, version: 0 });
      await seedVersions({ tenant, first: 0, count: 10, version: 30 });
    });

    /** @scenario "A version outside the dedup window never passes" */
    it("keeps only the version inside the window", async () => {
      const outer = windowOf(tenant);
      const inner = `${outer} AND UpdatedAt <= ${BASE} + INTERVAL 10 SECOND`;
      const result = await ch.query({
        query: `SELECT count() AS rows FROM trace_summaries
          WHERE ${outer} AND ${latestTraceVersionOnly({ where: inner })}`,
        format: "JSONEachRow",
      });
      const [row] = await result.json<{ rows: string }>();

      expect(Number(row?.rows)).toBe(10);
    });
  });

  describe("when 100,000 of 600,000 traces have an older and a newer version", () => {
    const tenant = freshTenant();

    beforeAll(async () => {
      for (let first = 0; first < 600_000; first += SEED_SLICE) {
        await seedVersions({ tenant, first, count: SEED_SLICE, version: 0 });
      }
      await seedVersions({ tenant, first: 0, count: 100_000, version: 5 });
    }, 180_000);

    /** @scenario "The latest-version dedup holds only traces with an older version" */
    it("counts every trace once on its newer version, in at most half the memory", async () => {
      const where = windowOf(tenant);
      const latest = await countLatest({
        tenant,
        dedup: latestTraceVersionOnly({ where }),
        version: 5,
      });
      const baseline = await countLatest({ tenant, dedup: everyLatestVersion(where), version: 5 });

      expect(latest.rows).toBe(600_000);
      expect(latest.onVersion).toBe(100_000);
      expect(latest.peakBytes).toBeGreaterThan(0);
      expect(latest.peakBytes).toBeLessThanOrEqual(baseline.peakBytes / 2);
    });
  });

  describe("when 50,000 traces have 20 versions each", () => {
    const tenant = freshTenant();

    beforeAll(async () => {
      for (let version = 1; version <= 20; version += 1) {
        await seedVersions({ tenant, first: 0, count: 50_000, version });
      }
    }, 180_000);

    /** @scenario "The latest-version dedup stays small when every trace has many versions" */
    it("counts every trace once on its newest version, holding one entry per trace", async () => {
      const where = windowOf(tenant);
      const latest = await countLatest({
        tenant,
        dedup: latestTraceVersionOnly({ where }),
        version: 20,
      });
      const baseline = await countLatest({ tenant, dedup: everyLatestVersion(where), version: 20 });

      expect(latest.rows).toBe(50_000);
      expect(latest.onVersion).toBe(50_000);
      expect(latest.peakBytes).toBeGreaterThan(0);
      expect(latest.peakBytes).toBeLessThanOrEqual(baseline.peakBytes * 2);
    });
  });
});
