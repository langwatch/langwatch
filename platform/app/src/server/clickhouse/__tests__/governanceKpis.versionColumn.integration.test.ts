import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Regression: governance_kpis uses ReplacingMergeTree(LastEventOccurredAt),
 * but LastEventOccurredAt moves backward as earlier-starting spans arrive
 * (the fold takes min(occurredAt, span.startTimeUnixMs)). After background
 * merge, ClickHouse keeps the row with the HIGHER version column — the
 * stale, lower-spend row — and discards the correct cumulative one.
 *
 * Fix: migration 00083 swaps the version column to CreatedAt (wall-clock
 * monotonic via DEFAULT now64(3)).
 *
 * @see https://github.com/langwatch/langwatch-saas/issues/1089
 */
describe("governance_kpis ReplacingMergeTree version column", () => {
  let client: ClickHouseClient;
  let database: string;
  const TABLE = "test_governance_kpis_version_col";

  beforeAll(async () => {
    const connectionUrl =
      process.env.CLICKHOUSE_URL ??
      "http://default:langwatch@localhost:8123/langwatch";
    const url = new URL(connectionUrl);
    database = url.pathname.replace("/", "") || "langwatch";
    client = createClient({ url: connectionUrl });
  });

  afterAll(async () => {
    await client.command({
      query: `DROP TABLE IF EXISTS ${database}.${TABLE}`,
    });
    await client.close();
  });

  describe("given version column is CreatedAt (the fix)", () => {
    beforeAll(async () => {
      await client.command({
        query: `DROP TABLE IF EXISTS ${database}.${TABLE}`,
      });

      // Mirrors governance_kpis schema but with CreatedAt as version column
      await client.command({
        query: `
          CREATE TABLE ${database}.${TABLE} (
            TenantId String,
            SourceId String,
            HourBucket DateTime,
            TraceId String,
            SourceType LowCardinality(String),
            SpendUsd Float64,
            PromptTokens UInt64,
            CompletionTokens UInt64,
            CreatedAt DateTime64(3),
            LastEventOccurredAt DateTime64(3)
          ) ENGINE = ReplacingMergeTree(CreatedAt)
          PARTITION BY toYYYYMM(HourBucket)
          ORDER BY (TenantId, SourceId, HourBucket, TraceId)
        `,
      });
    });

    it("keeps the latest-written row after merge even when LastEventOccurredAt moves backward", async () => {
      const hourBucket = "2026-08-01 10:00:00";

      // First flush: lower spend, higher LastEventOccurredAt, earlier CreatedAt
      await client.insert({
        table: `${database}.${TABLE}`,
        values: [
          {
            TenantId: "t1",
            SourceId: "src1",
            HourBucket: hourBucket,
            TraceId: "trace-abc",
            SourceType: "api_key",
            SpendUsd: 0.5,
            PromptTokens: 100,
            CompletionTokens: 50,
            CreatedAt: "2026-08-01 10:00:01.000",
            LastEventOccurredAt: "2026-08-01 10:05:00.000", // higher (later event)
          },
        ],
        format: "JSONEachRow",
      });

      // Second flush: higher spend (cumulative), LOWER LastEventOccurredAt
      // (because an earlier-starting span arrived), HIGHER CreatedAt (wall clock)
      await client.insert({
        table: `${database}.${TABLE}`,
        values: [
          {
            TenantId: "t1",
            SourceId: "src1",
            HourBucket: hourBucket,
            TraceId: "trace-abc",
            SourceType: "api_key",
            SpendUsd: 1.5,
            PromptTokens: 300,
            CompletionTokens: 150,
            CreatedAt: "2026-08-01 10:00:02.000",
            LastEventOccurredAt: "2026-08-01 09:55:00.000", // lower (earlier event folded in)
          },
        ],
        format: "JSONEachRow",
      });

      // Force merge — ReplacingMergeTree dedup fires
      await client.command({
        query: `OPTIMIZE TABLE ${database}.${TABLE} FINAL`,
      });

      const result = await client.query({
        query: `SELECT SpendUsd, PromptTokens, CompletionTokens FROM ${database}.${TABLE} WHERE TenantId = 't1' AND TraceId = 'trace-abc'`,
        format: "JSONEachRow",
      });
      const rows = await result.json<{
        SpendUsd: number;
        PromptTokens: number;
        CompletionTokens: number;
      }>();

      expect(rows).toHaveLength(1);
      // With CreatedAt as version column, the second (later) write survives
      expect(rows[0]!.SpendUsd).toBe(1.5);
      expect(rows[0]!.PromptTokens).toBe(300);
      expect(rows[0]!.CompletionTokens).toBe(150);
    });
  });

  describe("given version column is LastEventOccurredAt (the bug)", () => {
    const BUG_TABLE = `${TABLE}_bug`;

    beforeAll(async () => {
      await client.command({
        query: `DROP TABLE IF EXISTS ${database}.${BUG_TABLE}`,
      });

      // Same schema but with the BROKEN version column
      await client.command({
        query: `
          CREATE TABLE ${database}.${BUG_TABLE} (
            TenantId String,
            SourceId String,
            HourBucket DateTime,
            TraceId String,
            SourceType LowCardinality(String),
            SpendUsd Float64,
            PromptTokens UInt64,
            CompletionTokens UInt64,
            CreatedAt DateTime64(3),
            LastEventOccurredAt DateTime64(3)
          ) ENGINE = ReplacingMergeTree(LastEventOccurredAt)
          PARTITION BY toYYYYMM(HourBucket)
          ORDER BY (TenantId, SourceId, HourBucket, TraceId)
        `,
      });
    });

    afterAll(async () => {
      await client.command({
        query: `DROP TABLE IF EXISTS ${database}.${BUG_TABLE}`,
      });
    });

    it("discards the correct row after merge — documenting the defect", async () => {
      const hourBucket = "2026-08-01 10:00:00";

      // First flush: lower spend, higher LastEventOccurredAt
      await client.insert({
        table: `${database}.${BUG_TABLE}`,
        values: [
          {
            TenantId: "t1",
            SourceId: "src1",
            HourBucket: hourBucket,
            TraceId: "trace-abc",
            SourceType: "api_key",
            SpendUsd: 0.5,
            PromptTokens: 100,
            CompletionTokens: 50,
            CreatedAt: "2026-08-01 10:00:01.000",
            LastEventOccurredAt: "2026-08-01 10:05:00.000",
          },
        ],
        format: "JSONEachRow",
      });

      // Second flush: higher spend, LOWER LastEventOccurredAt
      await client.insert({
        table: `${database}.${BUG_TABLE}`,
        values: [
          {
            TenantId: "t1",
            SourceId: "src1",
            HourBucket: hourBucket,
            TraceId: "trace-abc",
            SourceType: "api_key",
            SpendUsd: 1.5,
            PromptTokens: 300,
            CompletionTokens: 150,
            CreatedAt: "2026-08-01 10:00:02.000",
            LastEventOccurredAt: "2026-08-01 09:55:00.000",
          },
        ],
        format: "JSONEachRow",
      });

      await client.command({
        query: `OPTIMIZE TABLE ${database}.${BUG_TABLE} FINAL`,
      });

      const result = await client.query({
        query: `SELECT SpendUsd FROM ${database}.${BUG_TABLE} WHERE TenantId = 't1' AND TraceId = 'trace-abc'`,
        format: "JSONEachRow",
      });
      const rows = await result.json<{ SpendUsd: number }>();

      expect(rows).toHaveLength(1);
      // BUG: merge keeps the row with higher LastEventOccurredAt (the stale one)
      expect(rows[0]!.SpendUsd).toBe(0.5); // stale value survives, not 1.5
    });
  });
});
