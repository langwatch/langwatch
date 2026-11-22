/**
 * Trace's id-index declarations against goose `00110_trace_id_indexes.sql`: the fill and the
 * reads name exactly the tables and views the migration creates. Spec:
 * specs/clickhouse/id-index-reads.feature
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { TRACE_ID_INDEXES } from "../clickhouse.trace-id-indexes.database.ts";

const GOOSE = readFileSync(
  resolve(
    import.meta.dirname,
    "../../../../../../../packages/clickhouse-migrations/migrations/00110_trace_id_indexes.sql",
  ),
  "utf8",
);

/** The goose block that starts with `opening`, up to its StatementEnd. */
function block({ opening }: { opening: string }): string {
  const start = GOOSE.indexOf(opening);
  if (start < 0) return "";
  return GOOSE.slice(start, GOOSE.indexOf("-- +goose StatementEnd", start));
}

describe("trace id-index declarations", () => {
  describe("when goose 00110 is read against them", () => {
    /** @scenario "the index table has no partition key" */
    it("creates each declared index unpartitioned, keyed by tenant then the declared key", () => {
      for (const declaration of TRACE_ID_INDEXES) {
        const table = block({
          opening: `CREATE TABLE IF NOT EXISTS \${CLICKHOUSE_DATABASE}.${declaration.index}\n`,
        });
        expect(table, declaration.index).not.toBe("");
        expect(table, declaration.index).not.toMatch(/PARTITION BY/);
        expect(table, declaration.index).toContain(
          `ORDER BY (TenantId, ${declaration.key.join(", ")})`,
        );
      }
    });

    it("feeds each index from a view over its declared source and time column", () => {
      for (const declaration of TRACE_ID_INDEXES) {
        const view = block({
          opening: `CREATE MATERIALIZED VIEW IF NOT EXISTS \${CLICKHOUSE_DATABASE}.${declaration.index}_mv\n`,
        });
        expect(view, declaration.index).toContain(
          `TO \${CLICKHOUSE_DATABASE}.${declaration.index} AS`,
        );
        expect(view, declaration.index).toContain(
          `min(${declaration.time}) AS FromAt, max(${declaration.time}) AS ToAt`,
        );
        expect(view, declaration.index).toContain(
          `FROM \${CLICKHOUSE_DATABASE}.${declaration.source}\n`,
        );
        expect(view, declaration.index).toContain(
          declaration.retention === "copied"
            ? "if(_retention_days = 0, 65535, _retention_days)"
            : "toUInt16(65535)",
        );
      }
    });

    it("declares every index the migration creates, and no other", () => {
      const created = [
        ...GOOSE.matchAll(/CREATE TABLE IF NOT EXISTS \$\{CLICKHOUSE_DATABASE\}\.(\w+)\n/g),
      ].map((match) => match[1] ?? "");
      const byName = (left: string, right: string) => left.localeCompare(right);
      expect(created.toSorted(byName)).toEqual(
        TRACE_ID_INDEXES.map((declaration) => declaration.index).toSorted(byName),
      );
    });
  });
});
