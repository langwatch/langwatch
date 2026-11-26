/**
 * The reader-zone bucket the templates and the completeness report share, run by a real
 * ClickHouse: a day starts at the reader's midnight across DST, an hour keeps both copies of the
 * repeated hour, and UTC keeps the epoch edges.
 * @see modules/analytics/specs/dashboard-widget-time-zone.feature
 * @vitest-environment node
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { lwqlBucketStartSql } from "@langwatch/analytics-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LangWatchQLParameter } from "../../rules/langwatch-ql-validation-shape.rules.ts";
import { LangWatchQLTimeWindowService } from "../../services/langwatch-ql-time-window.service.ts";

const url =
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL;
const DATABASE = `lwql_time_zone_${process.pid}`;
const timeWindows = LangWatchQLTimeWindowService.create();
const DECLARED: LangWatchQLParameter[] = [
  { name: "dashboard_context_period_start", type: "DateTime" },
  { name: "dashboard_context_period_end", type: "DateTime" },
  { name: "dashboard_context_timezone", type: "String" },
];
const BUCKET = lwqlBucketStartSql({
  column: "OccurredAt",
  granularity: "86400",
  timeZone: "{dashboard_context_timezone:String}",
});
const HOUR_BUCKET = lwqlBucketStartSql({
  column: "OccurredAt",
  granularity: "{dashboard_context_granularity_seconds:UInt32}",
  timeZone: "{dashboard_context_timezone:String}",
});
const WINDOW = { start: "2026-10-31T00:00:00.000Z", end: "2026-11-04T00:00:00.000Z" };
let client: ClickHouseClient;

/** Each trace's bucket start, for a run bound to `timeZone` by the time-window service. */
async function bucketsIn(
  timeZone: string | undefined,
  { bucket = BUCKET, timeWindow = WINDOW, granularitySeconds = 86_400 } = {},
): Promise<Record<string, string>> {
  const { parameters } = timeWindows.resolveTimeWindow({
    declared: DECLARED,
    timeWindow,
    timeZone,
  });
  const result = await client.query({
    query:
      `SELECT TraceId, toString(${bucket}) AS bucket FROM ${DATABASE}.traces ` +
      "WHERE OccurredAt >= {dashboard_context_period_start:DateTime} " +
      "AND OccurredAt < {dashboard_context_period_end:DateTime} ORDER BY TraceId",
    query_params: { ...parameters, dashboard_context_granularity_seconds: granularitySeconds },
    format: "JSONEachRow",
  });
  const rows = await result.json<{ TraceId: string; bucket: string }>();

  return Object.fromEntries(rows.map((row) => [row.TraceId, row.bucket]));
}

describe.skipIf(!url)("given traces on both sides of the night the clocks go back", () => {
  beforeAll(async () => {
    client = createClient({ url });
    await client.command({ query: `CREATE DATABASE IF NOT EXISTS ${DATABASE}` });
    await client.command({
      query: `CREATE TABLE ${DATABASE}.traces (TraceId String, OccurredAt DateTime64(3, 'UTC')) ENGINE = Memory`,
    });
    // 01:30 PDT, 01:30 PST (the repeated hour) and 23:59 PST, all on Nov 1 in Los Angeles.
    await client.command({
      query: `INSERT INTO ${DATABASE}.traces VALUES ('a', '2026-11-01 08:30:00.250'), ('b', '2026-11-01 09:30:00'), ('c', '2026-11-02 07:59:00')`,
    });
    // 01:30 EST and 03:30 EDT, either side of the hour New York skips on Mar 8.
    await client.command({
      query: `INSERT INTO ${DATABASE}.traces VALUES ('d', '2026-03-08 06:30:00'), ('e', '2026-03-08 07:30:00')`,
    });
  });

  afterAll(async () => {
    await client?.command({ query: `DROP DATABASE IF EXISTS ${DATABASE}` });
    await client?.close();
  });

  /** @scenario "TZ09 Day buckets start at the reader's midnight, across a DST change" */
  it("puts all three in Nov 1 starting at 07:00 UTC for Los Angeles", async () => {
    expect(await bucketsIn("America/Los_Angeles")).toEqual({
      a: "2026-11-01 07:00:00",
      b: "2026-11-01 07:00:00",
      c: "2026-11-01 07:00:00",
    });
  });

  /** @scenario "TZ14 Hourly buckets keep both copies of the hour the clocks go back" */
  it("puts the two 01:30s in Los Angeles in two hour buckets", async () => {
    const buckets = await bucketsIn("America/Los_Angeles", {
      bucket: HOUR_BUCKET,
      timeWindow: { start: "2026-11-01T07:00:00.000Z", end: "2026-11-01T11:00:00.000Z" },
      granularitySeconds: 3_600,
    });

    expect(buckets).toEqual({ a: "2026-11-01 08:00:00", b: "2026-11-01 09:00:00" });
  });

  /** @scenario "TZ15 Hourly buckets across the night the clocks go forward" */
  it("puts 01:30 and 03:30 in New York in the hours that start at 06:00 and 07:00 UTC", async () => {
    const buckets = await bucketsIn("America/New_York", {
      bucket: HOUR_BUCKET,
      timeWindow: { start: "2026-03-08T05:00:00.000Z", end: "2026-03-08T09:00:00.000Z" },
      granularitySeconds: 3_600,
    });

    expect(buckets).toEqual({ d: "2026-03-08 06:00:00", e: "2026-03-08 07:00:00" });
  });

  /** @scenario "TZ09 Day buckets start at the reader's midnight, across a DST change" */
  it("keeps the day edges on the reader's midnight through the grain placeholder", async () => {
    const buckets = await bucketsIn("America/Los_Angeles", { bucket: HOUR_BUCKET });

    expect(buckets).toEqual({
      a: "2026-11-01 07:00:00",
      b: "2026-11-01 07:00:00",
      c: "2026-11-01 07:00:00",
    });
  });

  /** @scenario "TZ09 Day buckets start at the reader's midnight, across a DST change" */
  it("keeps the UTC midnight edges when the run names no zone", async () => {
    expect(await bucketsIn(undefined)).toEqual({
      a: "2026-11-01 00:00:00",
      b: "2026-11-01 00:00:00",
      c: "2026-11-02 00:00:00",
    });
  });
});
