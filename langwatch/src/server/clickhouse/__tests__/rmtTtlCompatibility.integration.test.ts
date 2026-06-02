import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TEST_TABLE = "test_rmt_ttl_retention";

describe("ReplacingMergeTree + TTL retention compatibility", () => {
  let client: ClickHouseClient;
  let database: string;

  beforeAll(async () => {
    const connectionUrl =
      process.env.CLICKHOUSE_URL ?? "http://default:langwatch@localhost:8123/langwatch";
    const url = new URL(connectionUrl);
    database = url.pathname.replace("/", "") || "langwatch";
    client = createClient({ url: connectionUrl });

    await client.command({
      query: `CREATE TABLE IF NOT EXISTS ${database}.${TEST_TABLE} (
        TenantId String,
        TraceId String,
        OccurredAt DateTime64(3),
        UpdatedAt DateTime64(3),
        _retention_days UInt16 DEFAULT 0,
        Data String
      ) ENGINE = ReplacingMergeTree(UpdatedAt)
      PARTITION BY toYearWeek(OccurredAt)
      ORDER BY (TenantId, TraceId)`,
    });

    await client.command({
      query: `ALTER TABLE ${database}.${TEST_TABLE} MODIFY TTL
        IF(_retention_days > 0, toDateTime(OccurredAt) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
        SETTINGS materialize_ttl_after_modify = 0`,
    });
  });

  afterAll(async () => {
    await client.command({
      query: `DROP TABLE IF EXISTS ${database}.${TEST_TABLE}`,
    });
    await client.close();
  });

  it("deletes expired rows, preserves indefinite and not-expired rows after merge", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000);
    const now = new Date();

    await client.insert({
      table: `${database}.${TEST_TABLE}`,
      values: [
        {
          TenantId: "tenant-a",
          TraceId: "expired-row",
          OccurredAt: twoDaysAgo,
          UpdatedAt: twoDaysAgo,
          _retention_days: 1,
          Data: "should be deleted",
        },
        {
          TenantId: "tenant-a",
          TraceId: "not-expired-row",
          OccurredAt: twoDaysAgo,
          UpdatedAt: twoDaysAgo,
          _retention_days: 30,
          Data: "should survive",
        },
        {
          TenantId: "tenant-a",
          TraceId: "indefinite-row",
          OccurredAt: twoDaysAgo,
          UpdatedAt: twoDaysAgo,
          _retention_days: 0,
          Data: "kept forever",
        },
        {
          TenantId: "tenant-a",
          TraceId: "expired-row",
          OccurredAt: twoDaysAgo,
          UpdatedAt: now,
          _retention_days: 1,
          Data: "newer version, still expired",
        },
      ],
      format: "JSONEachRow",
    });

    await client.command({
      query: `OPTIMIZE TABLE ${database}.${TEST_TABLE} FINAL`,
    });

    const result = await client.query({
      query: `SELECT TraceId, _retention_days, Data FROM ${database}.${TEST_TABLE} ORDER BY TraceId`,
      format: "JSONEachRow",
    });

    const rows = await result.json<{
      TraceId: string;
      _retention_days: number;
      Data: string;
    }>();

    const traceIds = rows.map((r) => r.TraceId);

    expect(traceIds).not.toContain("expired-row");

    expect(traceIds).toContain("not-expired-row");
    expect(traceIds).toContain("indefinite-row");

    const indefiniteRow = rows.find((r) => r.TraceId === "indefinite-row");
    expect(indefiniteRow?._retention_days).toBe(0);
  });

  it("handles mixed-tenant partitions correctly", async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000);

    await client.insert({
      table: `${database}.${TEST_TABLE}`,
      values: [
        {
          TenantId: "tenant-short",
          TraceId: "short-retention",
          OccurredAt: threeDaysAgo,
          UpdatedAt: threeDaysAgo,
          _retention_days: 1,
          Data: "should be deleted",
        },
        {
          TenantId: "tenant-long",
          TraceId: "long-retention",
          OccurredAt: threeDaysAgo,
          UpdatedAt: threeDaysAgo,
          _retention_days: 90,
          Data: "should survive",
        },
      ],
      format: "JSONEachRow",
    });

    await client.command({
      query: `OPTIMIZE TABLE ${database}.${TEST_TABLE} FINAL`,
    });

    const result = await client.query({
      query: `SELECT TenantId, TraceId FROM ${database}.${TEST_TABLE} WHERE TraceId IN ('short-retention', 'long-retention')`,
      format: "JSONEachRow",
    });

    const rows = await result.json<{ TenantId: string; TraceId: string }>();
    const traceIds = rows.map((r) => r.TraceId);

    expect(traceIds).not.toContain("short-retention");
    expect(traceIds).toContain("long-retention");
  });
});
