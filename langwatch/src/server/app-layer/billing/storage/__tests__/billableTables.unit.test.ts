import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

import {
  RETENTION_MANAGED_TABLES,
  RETENTION_TABLE_CATEGORY_MAP,
} from "~/server/data-retention/retentionPolicy.schema";
import {
  BILLABLE_STORAGE_TABLES,
  EXCLUDED_RETENTION_TABLES,
} from "../billableTables";

const CLICKHOUSE_MIGRATIONS_DIR = path.join(
  __dirname,
  "../../../../clickhouse/migrations",
);

/**
 * Tables that carry a `_size_bytes` column according to the ClickHouse DDL —
 * the source of truth the billable set must be verified against (ADR-039:
 * a billable table without the column would error or silently bill 0).
 */
function tablesWithSizeBytesColumn(): Set<string> {
  const tables = new Set<string>();
  for (const file of fs.readdirSync(CLICKHOUSE_MIGRATIONS_DIR)) {
    if (!file.endsWith(".sql")) continue;
    const sql = fs.readFileSync(
      path.join(CLICKHOUSE_MIGRATIONS_DIR, file),
      "utf-8",
    );
    // A statement mentioning _size_bytes belongs to the table named by its
    // ALTER TABLE / CREATE TABLE header. Statements are separated by ";".
    for (const statement of sql.split(";")) {
      if (!statement.includes("_size_bytes")) continue;
      const header =
        /(?:ALTER|CREATE)\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:\S+\.)?`?(\w+)`?/i.exec(
          statement,
        );
      if (header?.[1]) tables.add(header[1]);
    }
  }
  return tables;
}

describe("BILLABLE_STORAGE_TABLES", () => {
  describe("when the billable-table set is resolved", () => {
    /** @scenario Derived analytics tables and evaluation runs are excluded from billable storage */
    it("contains exactly 10 tables", () => {
      expect(BILLABLE_STORAGE_TABLES).toHaveLength(10);
    });

    it("excludes the derived analytics tables and evaluation runs", () => {
      const billable = new Set<string>(BILLABLE_STORAGE_TABLES);
      expect(
        ["trace_analytics", "trace_analytics_rollup", "evaluation_runs"].filter(
          (table) => billable.has(table),
        ),
      ).toEqual([]);
    });

    it("carries per-row size accounting (_size_bytes) on every billable table, per the ClickHouse DDL", () => {
      const withColumn = tablesWithSizeBytesColumn();
      const missing = BILLABLE_STORAGE_TABLES.filter(
        (table) => !withColumn.has(table),
      );
      expect(missing).toEqual([]);
    });

    it("partitions the retention map exactly: billable + excluded = all 13 retention-managed tables", () => {
      const partition = [
        ...BILLABLE_STORAGE_TABLES,
        ...EXCLUDED_RETENTION_TABLES,
      ].sort();
      expect(partition).toEqual([...RETENTION_MANAGED_TABLES].sort());
    });

    it("maps every billable table to a retention category", () => {
      const uncategorized = BILLABLE_STORAGE_TABLES.filter(
        (table) => !(table in RETENTION_TABLE_CATEGORY_MAP),
      );
      expect(uncategorized).toEqual([]);
    });
  });
});
