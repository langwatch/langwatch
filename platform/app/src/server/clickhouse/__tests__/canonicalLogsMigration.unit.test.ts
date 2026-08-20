import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "src/server/clickhouse/migrations/00050_create_canonical_logs.sql",
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

describe("canonical log ClickHouse migration", () => {
  it("stores authoritative typed logs in weekly partitions", () => {
    const logs = tableDefinition("log_records");
    expect(logs).toContain("CanonicalPayload String");
    expect(logs).toContain("WireTraceId String");
    expect(logs).toContain("CorrelationTraceId String");
    expect(logs).toContain("PARTITION BY toYearWeek(TimeUnixMs)");
    expect(logs).toContain("_retention_days");
    expect(logs).toContain("_size_bytes");
  });

  it("keeps the usage ledger body-free and time-bounded", () => {
    const usage = tableDefinition("log_usage_estimates");
    expect(usage).toContain("OrganizationId String");
    expect(usage).toContain("CanonicalSourceBytes UInt32");
    expect(usage).toContain("TTL AcceptedAt + INTERVAL 13 MONTH DELETE");
    expect(usage).not.toMatch(/BodyJson|AttributesJson|CanonicalPayload/);
  });

  it("zeros both metric and log aggregate event bytes", () => {
    expect(migration).toContain("AggregateType IN ('metric', 'log')");
  });

  it("keeps legacy log storage during the rolling cutover", () => {
    expect(migration).not.toMatch(/DROP TABLE[^;]*stored_log_records/i);
  });
});
