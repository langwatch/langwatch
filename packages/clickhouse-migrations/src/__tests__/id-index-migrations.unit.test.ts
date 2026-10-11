/**
 * The id-index goose files (dev/docs/plans/id-index-2026-10-10.md §1): one per owner, each index
 * an unpartitioned AggregatingMergeTree keyed by tenant then id, fed by a view, never cold.
 * Spec: specs/clickhouse/id-index-reads.feature
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS = resolve(import.meta.dirname, "../../migrations");

/** The plan's final list: 16 indexes across 9 owners' files, `00110` to `00118`. */
const EXPECTED_INDEXES = [
  "trace_summaries_id_index",
  "stored_spans_id_index",
  "trace_analytics_id_index",
  "event_log_id_index",
  "evaluation_runs_id_index",
  "evaluation_analytics_id_index",
  "experiment_runs_id_index",
  "experiment_run_items_id_index",
  "dspy_steps_id_index",
  "simulation_runs_id_index",
  "suite_runs_id_index",
  "coding_agent_sessions_id_index",
  "coding_agent_session_events_id_index",
  "coding_agent_trace_sessions_id_index",
  "gateway_spend_id_index",
  "gateway_budget_ledger_events_id_index",
];

const TABLE = /CREATE TABLE IF NOT EXISTS \$\{CLICKHOUSE_DATABASE\}\.(\w+_id_index)\s/g;

type IndexTable = { file: string; name: string; definition: string; migration: string };

/** Every id-index `CREATE TABLE` block in every goose file, with the file it lives in. */
function indexTables(): IndexTable[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .toSorted()
    .flatMap((file) => {
      const migration = readFileSync(resolve(MIGRATIONS, file), "utf8");
      return [...migration.matchAll(TABLE)].map((match) => {
        const end = migration.indexOf("-- +goose StatementEnd", match.index);
        return {
          file,
          name: match[1] ?? "",
          definition: migration.slice(match.index, end < 0 ? undefined : end),
          migration,
        };
      });
    });
}

describe("id index migrations", () => {
  describe("when the id index migrations are read", () => {
    /** @scenario "the index table has no partition key" */
    it("declares no PARTITION BY and orders each index by tenant then id", () => {
      for (const table of indexTables()) {
        expect(table.definition, table.name).not.toMatch(/PARTITION BY/i);
        expect(table.definition, table.name).toMatch(/ORDER BY \(TenantId, \w+/);
        expect(table.definition, table.name).toContain("AggregatingMergeTree");
        expect(table.definition, table.name).toMatch(/FromAt SimpleAggregateFunction\(min,/);
        expect(table.definition, table.name).toMatch(/ToAt SimpleAggregateFunction\(max,/);
        expect(table.definition, table.name).not.toMatch(/storage_policy|TO VOLUME/i);
      }
    });

    it("feeds each index from a view on insert, never by POPULATE", () => {
      for (const table of indexTables()) {
        expect(table.migration, table.name).toContain(
          `CREATE MATERIALIZED VIEW IF NOT EXISTS \${CLICKHOUSE_DATABASE}.${table.name}_mv`,
        );
        expect(table.migration, table.name).toContain(`TO \${CLICKHOUSE_DATABASE}.${table.name}`);
        expect(table.migration, table.name).not.toMatch(/\bPOPULATE\b/i);
      }
    });

    // Fails until slices 3 to 7 land every owner's goose file; then `it.fails` becomes `it`.
    it.fails("holds exactly the plan's 16 index tables across 9 files", () => {
      const tables = indexTables();
      expect(tables.map((table) => table.name).toSorted()).toEqual(EXPECTED_INDEXES.toSorted());
      expect(new Set(tables.map((table) => table.file)).size).toBe(9);
    });
  });
});
