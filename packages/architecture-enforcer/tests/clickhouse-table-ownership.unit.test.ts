import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clickhouseTables,
  collectClickhouseOwnershipFindings,
  lintClickhouseTableOwnershipAt,
} from "../src/policies/persistence/clickhouse-table-ownership.ts";
import type { FeatureCatalogueEntry } from "../src/types.ts";

/**
 * @see specs/tooling/lint-clickhouse-table-ownership.feature
 */

const roots: string[] = [];

const CATALOGUE: FeatureCatalogueEntry[] = [
  { id: "trace", root: "modules/trace", classification: "core", subjects: ["trace"] },
  { id: "analytics", root: "modules/analytics", classification: "core", subjects: ["analytics"] },
];

const CREATE_TRACE_SUMMARIES = `-- +goose Up
CREATE TABLE IF NOT EXISTS \${CLICKHOUSE_DATABASE}.trace_summaries (TenantId String) ENGINE = MergeTree;
`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "clickhouse-ownership-"));
  roots.push(root);
  const write = (file: string, content: string) => {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  write(
    "packages/clickhouse-client/migrations/00001_create_trace_summaries.sql",
    CREATE_TRACE_SUMMARIES,
  );

  return {
    root,
    write,
    migration: (name: string, sql: string) =>
      write(`packages/clickhouse-client/migrations/${name}`, sql),
    findings: () => collectClickhouseOwnershipFindings(root, CATALOGUE),
    messages: () =>
      collectClickhouseOwnershipFindings(root, CATALOGUE).map((finding) => finding.message),
    lint: () => lintClickhouseTableOwnershipAt({ root, catalogue: CATALOGUE }),
  };
}

function writer(table: string): string {
  return `export async function store(client: { insert: (options: unknown) => Promise<void> }) {
  await client.insert({ table: "${table}", values: [], format: "JSONEachRow" });
}
`;
}

function reader(table: string): string {
  return `export function query(): string {
  return \`SELECT TenantId FROM ${table} WHERE TenantId = {tenantId:String}\`;
}
`;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ClickHouse table ownership", () => {
  describe("given one module writes a table", () => {
    /** @scenario "A module reading a table another module writes is reported" */
    it("reports a second module that reads it", () => {
      const workspace = fixture();
      workspace.write(
        "modules/trace/server/src/repositories/clickhouse/trace-summary.repository.ts",
        writer("trace_summaries"),
      );
      workspace.write(
        "modules/analytics/server/src/repositories/clickhouse/summary.mapper.ts",
        reader("trace_summaries"),
      );

      expect(workspace.messages()).toEqual(["analytics reads trace_summaries, owned by trace."]);
      expect(workspace.lint()[0]?.allowed).toContain("read it elsewhere through that module's api");
    });

    /** @scenario "The module that writes a table may also read it" */
    it("accepts the owner reading its own table", () => {
      const workspace = fixture();
      workspace.write(
        "modules/trace/server/src/repositories/clickhouse/trace-summary.repository.ts",
        `${writer("trace_summaries")}${reader("trace_summaries")}`,
      );

      expect(workspace.messages()).toEqual([]);
    });

    /** @scenario "A test naming a table is not access" */
    it("ignores a table another module only names in its tests", () => {
      const workspace = fixture();
      workspace.write(
        "modules/trace/server/src/repositories/clickhouse/trace-summary.repository.ts",
        writer("trace_summaries"),
      );
      workspace.write(
        "modules/analytics/server/src/__tests__/summary.unit.test.ts",
        reader("trace_summaries"),
      );

      expect(workspace.messages()).toEqual([]);
    });

    /** @scenario "A table name reached through a file constant is still access" */
    it("resolves a table named by a file-level constant", () => {
      const workspace = fixture();
      workspace.write(
        "modules/trace/server/src/repositories/clickhouse/trace-summary.repository.ts",
        writer("trace_summaries"),
      );
      workspace.write(
        "modules/analytics/server/src/repositories/clickhouse/summary.mapper.ts",
        `const TABLE_NAME = "trace_summaries" as const;
export function query(): string {
  return \`SELECT TenantId FROM \${TABLE_NAME}\`;
}
`,
      );

      expect(workspace.messages()).toEqual(["analytics reads trace_summaries, owned by trace."]);
    });
  });

  describe("given two modules write one table", () => {
    /** @scenario "A table two modules write is reported as two owners" */
    it("names both writers and the file the first claims it from", () => {
      const workspace = fixture();
      workspace.write(
        "modules/analytics/server/src/repositories/clickhouse/summary.repository.ts",
        writer("trace_summaries"),
      );
      workspace.write(
        "modules/trace/server/src/repositories/clickhouse/trace-summary.repository.ts",
        writer("trace_summaries"),
      );

      expect(workspace.messages()).toEqual([
        "Table trace_summaries is written by trace and analytics (modules/analytics/server/src/repositories/clickhouse/summary.repository.ts). Keep a single module owner.",
      ]);
    });
  });

  describe("given no module writes a table", () => {
    /** @scenario "A table no module writes is its own finding" */
    it("reports the table and names the migration that created it", () => {
      const workspace = fixture();

      expect(workspace.messages()).toEqual(["Table trace_summaries has no module owner."]);
      expect(workspace.findings()[0]?.file).toContain("00001_create_trace_summaries.sql");
    });

    /** @scenario "The migrations and the ClickHouse client are not module access" */
    it("does not read the ClickHouse client package as a module", () => {
      const workspace = fixture();
      workspace.write(
        "packages/clickhouse-client/src/trace-summary.reader.ts",
        reader("trace_summaries"),
      );

      expect(workspace.messages()).toEqual(["Table trace_summaries has no module owner."]);
    });
  });

  describe("given the migrations shape the table list", () => {
    /** @scenario "A materialised view belongs to the table it feeds" */
    it("folds a materialised view onto the table it feeds", () => {
      const workspace = fixture();
      workspace.migration(
        "00002_create_view.sql",
        `-- +goose Up
CREATE MATERIALIZED VIEW IF NOT EXISTS \${CLICKHOUSE_DATABASE}.trace_summaries_mv TO trace_summaries AS SELECT 1;
`,
      );

      expect([...clickhouseTables(workspace.root).keys()]).toEqual(["trace_summaries"]);
    });

    /** @scenario "A table a later migration drops is not a table" */
    it("drops a table a later migration removes", () => {
      const workspace = fixture();
      workspace.migration(
        "00002_drop_trace_summaries.sql",
        `-- +goose Up
DROP TABLE IF EXISTS \${CLICKHOUSE_DATABASE}.trace_summaries;
`,
      );

      expect([...clickhouseTables(workspace.root).keys()]).toEqual([]);
      expect(workspace.messages()).toEqual([]);
    });

    /** @scenario "A rollback half of a migration does not create a table" */
    it("ignores a table only the goose Down half creates", () => {
      const workspace = fixture();
      workspace.migration(
        "00002_scratch.sql",
        `-- +goose Up
SELECT 1;
-- +goose Down
CREATE TABLE IF NOT EXISTS \${CLICKHOUSE_DATABASE}.trace_summaries_rebuild (TenantId String) ENGINE = MergeTree;
`,
      );

      expect([...clickhouseTables(workspace.root).keys()]).toEqual(["trace_summaries"]);
    });
  });

  describe("given a baseline row nothing matches", () => {
    /** @scenario "A baselined finding is excused and a stale row is reported" */
    it("reports the row as stale and says to delete it", () => {
      const workspace = fixture();
      workspace.write(
        "modules/trace/server/src/repositories/clickhouse/trace-summary.repository.ts",
        writer("trace_summaries"),
      );
      workspace.write(
        "packages/architecture-enforcer/src/clickhouse-table-ownership-baseline.json",
        JSON.stringify({
          version: 1,
          policy: "clickhouse-table-ownership",
          entries: [{ key: "analytics|trace_summaries", measured: "2026-09-10" }],
        }),
      );

      expect(workspace.lint()).toEqual([
        {
          policy: "clickhouse-table-ownership-baseline",
          file: join(
            workspace.root,
            "packages/architecture-enforcer/src/clickhouse-table-ownership-baseline.json",
          ),
          message:
            "ClickHouse table ownership baseline entry analytics/trace_summaries no longer matches anything and must be removed.",
          allowed: "Delete the stale entry so the checked-in inventory only shrinks.",
          stale: true,
        },
      ]);
    });
  });
});
