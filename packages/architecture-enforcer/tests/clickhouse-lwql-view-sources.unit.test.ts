import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  clickhouseScanAt,
  collectClickhouseOwnershipFindings,
  type DeclaredOwnership,
} from "../src/policies/persistence/clickhouse-table-ownership.ts";
import type { FeatureCatalogueEntry } from "../src/types.ts";

/**
 * @see packages/architecture-enforcer/specs/clickhouse-lwql-view-sources.feature
 */

const roots: string[] = [];

const CATALOGUE: FeatureCatalogueEntry[] = [
  { id: "trace", root: "modules/trace", classification: "core", subjects: ["trace"] },
  { id: "analytics", root: "modules/analytics", classification: "core", subjects: ["analytics"] },
];

const NOTHING: DeclaredOwnership = { records: [], exceptions: [], shared: [] };
const SHARED: DeclaredOwnership = {
  ...NOTHING,
  shared: [{ table: "trace_summaries", owner: "trace", readers: ["analytics"], reason: "fixture" }],
};

const VIEW_CATALOGUE = "modules/analytics/process/src/rules/lwql-view-catalog.rules.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "clickhouse-lwql-views-"));
  roots.push(root);
  const write = (file: string, content: string) => {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  write(
    "packages/clickhouse-migrations/migrations/00001_create_trace_summaries.sql",
    `-- +goose Up
CREATE TABLE IF NOT EXISTS \${CLICKHOUSE_DATABASE}.trace_summaries (TenantId String) ENGINE = MergeTree;
`,
  );
  write(
    "modules/trace/process/src/repositories/clickhouse/trace-summary.repository.ts",
    "export const insert = `INSERT INTO trace_summaries (TenantId) VALUES ({tenantId:String})`;\n",
  );

  return {
    view: (sourceTable: string) =>
      write(
        VIEW_CATALOGUE,
        `export const TRACES: UngatedViewDefinition = {\n  name: "traces",\n  sourceTable: "${sourceTable}",\n  columns: [],\n};\n`,
      ),
    write,
    reads: () =>
      clickhouseScanAt(root, CATALOGUE)
        .access.filter((entry) => entry.module === "analytics")
        .map((entry) => ({ table: entry.table, write: entry.write })),
    messages: (declared: DeclaredOwnership = NOTHING) =>
      collectClickhouseOwnershipFindings(root, CATALOGUE, declared).map(
        (finding) => finding.message,
      ),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("LangWatchQL view sources", () => {
  describe("given analytics declares a view over trace's table", () => {
    /** @scenario "A LangWatchQL view over another module's table is a foreign read" */
    it("reports the view's source table as analytics' foreign read", () => {
      const workspace = fixture();
      workspace.view("trace_summaries");

      expect(workspace.reads()).toEqual([{ table: "trace_summaries", write: false }]);
      expect(workspace.messages()).toEqual(["analytics reads trace_summaries, owned by trace."]);
    });

    /** @scenario "A shared table read only through a LangWatchQL view keeps its share" */
    it("admits the read through the share and keeps the share live", () => {
      const workspace = fixture();
      workspace.view("trace_summaries");

      expect(workspace.messages(SHARED)).toEqual([]);
    });
  });

  describe("given objects that only look like a view", () => {
    /** @scenario "A sourceTable outside a LangWatchQL view declaration is not a read" */
    it("reads a catalogue table's source and never untyped metadata's", () => {
      const workspace = fixture();
      workspace.write(
        VIEW_CATALOGUE,
        `const migrationNotes = { sourceTable: "trace_summaries" };
export const TRACES_TABLE = defineTableCatalogue({
  sourceTable: "trace_summaries",
  columns: {},
});
`,
      );

      expect(workspace.reads()).toEqual([{ table: "trace_summaries", write: false }]);
    });
  });

  describe("given a view whose source is not a ClickHouse table", () => {
    /** @scenario "A sourceTable that names no ClickHouse table is not a read" */
    it("records no access", () => {
      const workspace = fixture();
      workspace.view("Project");

      expect(workspace.reads()).toEqual([]);
    });
  });
});
