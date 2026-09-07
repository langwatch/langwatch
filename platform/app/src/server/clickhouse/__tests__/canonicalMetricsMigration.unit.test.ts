import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "src/server/clickhouse/migrations/00049_create_canonical_metrics.sql",
  ),
  "utf8",
);

function tableDefinition(table: string): string {
  const start = migration.indexOf(
    `CREATE TABLE IF NOT EXISTS \${CLICKHOUSE_DATABASE}.${table}`,
  );
  const end = migration.indexOf("-- +goose StatementEnd", start);
  if (start < 0 || end < 0) throw new Error(`missing ${table} definition`);
  return migration.slice(start, end);
}

describe("canonical metric ClickHouse migration", () => {
  it("time-partitions every retention-managed metric projection", () => {
    expect(tableDefinition("metric_data_points")).toContain(
      "PARTITION BY toYearWeek(TimeUnixMs)",
    );
    expect(tableDefinition("metric_series")).toContain(
      "PARTITION BY toYearWeek(LastSeenAt)",
    );
    expect(tableDefinition("metric_time_rollups")).toContain(
      "PARTITION BY toYearWeek(BucketStart)",
    );
    expect(tableDefinition("metric_usage_estimates")).toContain(
      "PARTITION BY toYYYYMM(AcceptedAt)",
    );
  });

  it("keeps project metric storage separate from organization shadow context", () => {
    const raw = tableDefinition("metric_data_points");
    expect(raw).toContain("TenantId String");
    expect(raw).not.toContain("OrganizationId");
    expect(raw).toContain("OccurredAt DateTime64(3)");
    expect(raw).toContain("AcceptedAt DateTime64(3)");
    expect(raw).toContain("WrittenAt DateTime64(3) DEFAULT now64(3)");
    expect(raw).toContain(
      "ORDER BY (TenantId, SeriesId, TimeUnixMs, TimeUnixNano, PointId)",
    );

    const shadow = tableDefinition("metric_usage_estimates");
    expect(shadow).toContain("OrganizationId String");
    expect(shadow).toContain("TenantId String");
    expect(shadow).toContain("AcceptedHour DateTime");
    expect(shadow).toContain("TTL AcceptedAt + INTERVAL 13 MONTH DELETE");
    expect(shadow).not.toMatch(
      /Attributes|CanonicalPayload|ValueDouble|BucketCounts/,
    );

    const catalog = tableDefinition("metric_series");
    expect(catalog).toContain("MetricDescription String");
    expect(catalog).not.toContain("CanonicalPayload");
  });

  it("uses the deployment engine and storage-policy macros", () => {
    for (const table of [
      "metric_data_points",
      "metric_series",
      "metric_time_rollups",
      "metric_usage_estimates",
    ]) {
      const definition = tableDefinition(table);
      expect(definition).toContain("CLICKHOUSE_ENGINE_REPLACING_PREFIX");
      expect(definition).toContain("CLICKHOUSE_STORAGE_POLICY_SETTING");
    }
  });

  it("zeros metric event-log bytes for production storage metering", () => {
    expect(migration).toContain(
      "if(AggregateType = 'metric', 0, byteSize(EventPayload, ProcessingTraceparent))",
    );
  });

  it("does not drop legacy storage before rolling cutover completes", () => {
    expect(migration).not.toMatch(/DROP TABLE[^;]*stored_metric_records/i);
    expect(migration).toContain("separate, reviewed post-cutover migration");
  });
});
